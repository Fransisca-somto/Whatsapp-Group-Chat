# Step 07 — Phase 5: Scheduler and Dashboard Scheduling

> Covers `progress.md` Phase 5, tasks **5.1–5.5**.
> Status: **plan, awaiting owner approval.** No code is written until the owner approves (CLAUDE.md §1).
> Branch: `phase-5`, created from `main` (Phase 4 merged in PR #4). One commit per task.
> Phase rule: Phase 4 is not fully ✅ (task 4.4 retention waits for the owner's live check around 2026-11-23). Starting Phase 5 now needs the owner's explicit approval; the retention check does not depend on anything here.

## Goal
Admins create announcements and reminders on the dashboard (one-off or repeating), and the bot posts them in the right group on time, on its own. A post is never sent twice: anything whose delivery is in doubt goes to a **Needs attention** list with a Resend button instead of being sent again automatically.

## What exists already
- Table `scheduled_posts` with the status state machine (data-models.md §3.9), RLS read/write for dashboard users, and the index on due rows.
- `claim_due_posts(token, limit)`: atomically moves due rows of **active** groups from `scheduled` to `sending` (`for update skip locked`).
- The send queue (one message at a time, 1.5 s+ apart). It already tells two kinds of failure apart: **not sent** (`not_connected`, `stopped`, before anything reached WhatsApp) and **maybe sent** (`timeout`, after the message was handed to WhatsApp).
- The `lateNote` template and the `time.ts` helpers (`zonedLocalToUtc`, etc.).
- Server action names reserved in api-interfaces.md §3 (`createScheduledPost`, `updateScheduledPost`, `cancelScheduledPost`, `resendScheduledPost`).

## How it works (plain language)
1. **Creating.** On `/schedule`, an admin picks the group, Reminder or Announcement, writes the text, picks a date and time (company timezone) and, optionally, how it repeats.
2. **Posting.** Every 30 seconds, while WhatsApp is connected, the worker takes the posts that are due and sends them one by one, at least 3 seconds apart. Each one is recorded as sent with its WhatsApp message ID, and appears in the group's chat view.
3. **Late posts.** If the worker was down or disconnected: up to 2 hours late, the post still goes out with a short "(Sent late …)" note; more than 2 hours late, it is **skipped** and listed under Needs attention.
4. **Never twice.** If the worker stops in the middle of sending, or WhatsApp doesn't confirm in time, the post is marked **Delivery uncertain** (it may or may not be in the group). An admin checks the group and clicks Resend if it's missing. The bot never decides this on its own.
5. **Repeating posts.** A repeating post exists as one upcoming row at a time. When it is posted (or skipped, or fails), the next one is created for the next date. Cancelling the upcoming one ends the series.

## Proposed decisions (owner to confirm)
| # | Proposal | Recommendation |
|---|---|---|
| P14 | **Repeat options:** Daily · Weekdays (Mon–Fri) · Weekly on chosen days · Monthly on a day (1–28, or "last day of the month"). Stored as standard RRULE text, but only these forms are accepted. No end date: a series runs until cancelled. No new library (computed with the existing date helpers in the company timezone, so 9:00 stays 9:00 across daylight-saving changes). | Yes (covers normal team routines; avoids the 29th–31st problem and a large library) |
| P15 | **How posts look:** a reminder is sent as `*Reminder:* <text>`; an announcement is sent exactly as written. No emojis (ADR-029). | Yes |
| P16 | **Text length:** 1–2,000 characters. Time must be at least 1 minute ahead and at most 1 year ahead. Posts can be created for active or paused groups (a paused group's posts wait, and are skipped if more than 2 h late when it resumes). | Yes |
| P17 | **Failures are sorted by what WhatsApp saw:** not connected / worker stopping before sending → back to *scheduled*, tried again on the next tick (nothing reached WhatsApp, so no risk of a duplicate); WhatsApp rejected it → *failed*; no confirmation within 15 s, or a crash mid-send → *delivery uncertain*. | Yes (avoids failing posts during a short disconnect, and never risks a duplicate) |
| P18 | **Needs attention** lists *failed*, *delivery uncertain* and *skipped (late)* posts. Actions: **Resend** (posts it on the next tick; for uncertain posts the dialog says to check the group first) and **Dismiss** (moves it to History). Migration adds `dismissed_at`. | Yes |
| P19 | **Repeating series catch up forward:** after a long outage, the next occurrence is the first one *after now*, not a backlog of missed ones. | Yes |
| P20 | **Group page gets a Scheduled tab** listing that group's upcoming posts, with a "New post" button that opens the same form with the group filled in. The Overview page shows the next 5 posts and a Needs attention count (ui-context.md §4). | Yes |

## Tasks

### 5.1 `/schedule` page and server actions
- **Shared** (`packages/shared`): `scheduledPostInputSchema` (group, kind, body, `dueAtLocal`, optional `repeat`), `recurrence.ts` (P14 presets ↔ RRULE text, `nextOccurrence(rule, after, timezone)`, a readable label such as "Every weekday at 9:00 AM"), `formatScheduledPost` (P15).
- **Server actions** (`server/actions/schedule.ts`): `createScheduledPost`, `updateScheduledPost` (only while `scheduled`; conditional update so a post being sent can't be edited), `cancelScheduledPost` (only while `scheduled`), `resendScheduledPost` (only `failed` / `delivery_uncertain` / `skipped_late` → `scheduled`, `due_at = now`, clears `claim_token` and `last_error`), `dismissScheduledPost`. Each checks the role, validates with zod, writes, and audits (`post_created`, `post_updated`, `post_cancelled`, `post_resent`, `post_dismissed`).
- **Page** `/schedule`: tabs **Upcoming · Needs attention · History** (`?tab=`, `?group=` filter), table on desktop / cards on mobile, `<StatusBadge>` for statuses, "New post" button.
- **`<ScheduledPostDialog>`**: group, Reminder / Announcement, text with counter, `<DateTimePicker>` (new shared component: native date-time input, interpreted in the company timezone, with the timezone label), repeat options (P14), and a live preview of what the group will see (P15).
- Group page **Scheduled** tab and Overview cards (P20).

### 5.2 Worker poller with atomic claiming
- `scheduler/scheduler.ts`: leader-only, every 30 s, **only while WhatsApp is connected** (a disconnected worker doesn't claim anything, so nothing fails just because the connection blinked). Started and stopped with the leader session like the indexing job.
- `db/scheduledPostsRepo.ts`: claim (through `claim_due_posts`, 10 at a time), mark sent / failed / uncertain / back to scheduled, mark late, insert next occurrence.
- Sending through the existing send queue (no quote, no typing), **at least 3 s between posts**; the sent post is stored in `group_messages` as a bot message so it shows in the chat view (and is skipped by search indexing, like other bot messages).
- Outcomes per P17. System audit rows: `post_sent` (detail `late`, `waMessageId`), `post_failed` (`error`), `post_uncertain` (`reason`).

### 5.3 Late handling and delivery-uncertain recovery
- **Start of every leader session** (before the first claim): rows still in `sending` → `delivery_uncertain`, `last_error = "worker stopped while sending"` (audit `post_uncertain`). Only the leader sends, so anything left in `sending` at startup belongs to a session that stopped.
- **Each tick, before claiming:** `scheduled` posts of active groups due more than **2 hours** ago → `skipped_late` (audit `post_skipped_late`).
- A post sent more than **2 minutes** after its time gets the `lateNote` on a new line: *(Sent late: this was scheduled for 9:00 AM.)*, with the day added when it is not today.

### 5.4 Repeating posts
- After a repeating post leaves `scheduled` for good (sent, failed, uncertain or skipped), the worker inserts the next occurrence (`parent_post_id` = the first post of the series, same group, kind, text and rule; `created_via = 'dashboard'`). P19: the first occurrence after now.
- Guarded so a series can never fork: a partial unique index allows **one `scheduled` row per series** (migration), and the insert ignores a duplicate.
- Editing the upcoming post edits the series from then on; cancelling it ends the series.

### 5.5 Needs attention and Resend
- Tab lists `failed`, `delivery_uncertain`, `skipped_late` where `dismissed_at` is null, newest first, each with the reason in plain words and its time.
- **Resend** (`<ConfirmDialog>`): for *delivery uncertain* the dialog says "Check the group first: it may already have been posted." Resent posts go out on the next tick with no late note.
- **Dismiss** moves it to History. A sidebar count badge on Schedule shows how many need attention.

## Database (migration `0012_scheduler.sql`)
- `scheduled_posts.dismissed_at timestamptz` (P18).
- Partial unique index `scheduled_posts_one_upcoming_per_series` on `(coalesce(parent_post_id, id))` where `status = 'scheduled' and recurrence_rule is not null` (5.4).
- Check: `char_length(body) between 1 and 2000` (P16).
- Index for the Needs attention list: `(status, due_at desc)` where `status in ('failed','delivery_uncertain','skipped_late') and dismissed_at is null`.
- `claim_due_posts` unchanged. Regenerate `database.types.ts`.

## Files
**Shared:** `src/recurrence.ts` (+ test), `src/schemas/scheduledPost.ts` (+ test), `src/scheduledPosts.ts` (format, labels, + test), `src/schemas/index.ts`, `src/database.types.ts`.
**Worker:** `src/scheduler/scheduler.ts` (+ test), `src/db/scheduledPostsRepo.ts`, `src/assistant/templates.ts` (`lateNote` wording), `src/index.ts` (start/stop with the leader session, after the connection opens).
**Dashboard:** `app/(app)/schedule/page.tsx`, `ScheduleTabs`/list components, `ScheduledPostDialog.tsx` (+ tests), `components/DateTimePicker.tsx` (+ test), `server/actions/schedule.ts` (+ test), `lib/schedule.ts` (labels, + test), `lib/audit.ts` (+ test, new actions), group page Scheduled tab, Overview cards, sidebar badge, `<StatusBadge>` statuses for posts.
**Database:** `supabase/migrations/0012_scheduler.sql`.

## Docs to update
- `progress.md`: Phase 5 tasks, session log, ADR-033 (repeat presets as RRULE subset, one upcoming row per series, catch-up forward), ADR-034 (failure sorting by what WhatsApp saw; amends the state machine: `sending → scheduled` when nothing was sent).
- `data-models.md`: §3.9 new column, indexes, check, updated state machine.
- `api-interfaces.md`: §3 schedule actions (final shapes), §4.1 scheduler audit actions, §8.1 tick order (pending-reminder expiry stays for Phase 6), §5.4 `lateNote`.
- `architecture.md`: §2 `scheduler/` contents.
- `ui-context.md`: `/schedule`, group Scheduled tab, Overview, `<DateTimePicker>` ✅, post statuses in `<StatusBadge>`.

## Alternatives considered
- **The `rrule` npm library with full RRULE support:** handles any rule, but adds a dependency with known timezone pitfalls, and the dashboard would need a full rule editor. The presets cover the stated need.
- **Pre-creating many future occurrences of a series:** easier to list ahead, but edits and cancels would have to touch many rows, and an outage would fire a pile of them. One upcoming row is simpler and safe.
- **Marking every send error `failed`:** simpler, but a 10-second disconnect at 9:00 would fail the morning's posts; P17 retries only when nothing reached WhatsApp.
- **Running the scheduler in the database (`pg_cron`):** it can't send WhatsApp messages; only the worker holds the connection.

## Risks / open questions
- **Changing the company timezone** later doesn't move posts already scheduled (they are stored as exact times); repeating series use the new timezone from their next occurrence. The Settings page will say so.
- **"Delivery uncertain" needs a human check.** Rare (worker crash or WhatsApp not confirming within 15 s), but it is the price of never sending twice (ADR-011).
- **Many posts at the same minute** go out 3+ s apart, so 20 posts take about a minute; fine for staff groups.
- **Phase 6 overlap:** tag-created reminders (Phase 6) will reuse this table and sender; nothing here is reminder-by-tag.

## Verify
**Automated**
- Recurrence: each preset's next date (incl. month ends, "last day", weekdays over a weekend, a DST zone such as Europe/London), labels, RRULE round-trip, rejection of unsupported rules.
- Scheduler: claims only while connected; sent → `sent` + message ID + bot message stored; not connected / stopped → back to `scheduled`; rejected → `failed`; timeout → `delivery_uncertain`; startup turns leftover `sending` into `delivery_uncertain`; > 2 h late → `skipped_late`; > 2 min late → late note; 3 s gap between posts; next occurrence created once (and never twice).
- Server actions: roles, validation, only-while-scheduled edits/cancels, resend/dismiss rules, audit rows. Dialog, picker and tabs render and submit.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, dashboard build.

**Database (after the owner applies 0012)**
- The agent checks the new column and indexes exist.

**Live (owner, in "Softwirelex group")**
1. Schedule an announcement 2 minutes ahead → it arrives within 30 s of the time, and shows as Sent.
2. Schedule a reminder → it arrives as "*Reminder:* …".
3. Create a "Daily" post a few minutes ahead → after it is sent, Upcoming shows tomorrow's.
4. Stop the worker, let a post fall due, start it within 2 h → sent with the late note. (Optional: leave one more than 2 h → Skipped in Needs attention → Resend → arrives.)
5. Edit and cancel an upcoming post; both show in the Audit log.

## Out of scope for this step
- Creating reminders by tagging the bot (Phase 6).
- Reminders that @mention people; media attachments in posts.
- Automatic resending of uncertain posts (never, by design).
- End dates or custom rules for repeating posts (possible later).

## Exit criteria (from progress.md)
- Posts arrive within 30 s of their due time.
- A crash and restart never produces a duplicate.
- All checks pass and the docs above are updated.
