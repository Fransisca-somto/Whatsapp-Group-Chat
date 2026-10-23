# Step 08 — Phase 6: Tag-to-Create Reminders

> Covers `progress.md` Phase 6, tasks **6.1–6.5**.
> Status: **plan, awaiting owner approval.** No code is written until the owner approves (CLAUDE.md §1).
> Branch: `phase-6`, created from `main` once `phase-5` is merged. One commit per task.

## Goal
A team member tags the bot ("@bot remind us Friday 3pm to submit reports"), the bot repeats back exactly what it understood with the full date and time, and only that person can confirm with "yes" within 2 minutes. Only then is the reminder saved; the Phase 5 scheduler posts it. Who may do this is decided by code from the dashboard's authorized-user list and the group's permission setting, never by the AI.

## What exists already
- `authorized_users` + `authorized_user_groups` tables with RLS (dashboard read/write); the shared `authorizedUserSchema` and `phoneE164Schema`.
- `pending_reminder_requests` with the one-awaiting-per-person-per-group unique index, and its spec (api-interfaces.md §5.3).
- Each group's **Who can create reminders** setting (`admins_only` default / `any_member`) on its Settings tab.
- The intent classifier already returns `create_reminder` with `body`, `dueAtLocal` and `confidence`; today the pipeline replies "Setting reminders here isn't available yet."
- The sender's phone is resolved on every message (phone JID, alternate JID, then Baileys' LID-to-phone map); `null` when WhatsApp hides it.
- Scheduler, `scheduled_posts` (`created_via = 'group'` allowed) and the dashboard lists from Phase 5.

## How it works (plain language)
1. **Tag.** "@bot remind us Friday 3pm to submit reports." The AI only labels it and pulls out the text and the time.
2. **Permission (code).** In an *admins only* group, the sender's phone must be on the authorized-user list (all groups, or this group). In an *any member* group, anyone may. If the bot can't see the sender's number in an admins-only group, it says so and refuses.
3. **Check (code).** A clear day and time, at least 3 minutes and at most 1 year ahead, text 1–500 characters. Otherwise the bot asks them to say it again.
4. **Repeat back.** *"Reminder for Friday 30 Oct at 3:00 PM WAT: submit reports. Reply yes to confirm or no to cancel."*
5. **Confirm.** Only the person who asked, within 2 minutes: "yes" saves it and the bot replies *"Done. Reminder set for Friday 30 Oct at 3:00 PM WAT."*; "no" cancels. Anyone else's "yes" does nothing. Silence: nothing is saved.
6. **Posting.** At the time, the scheduler posts *"Reminder: submit reports"* like any other reminder. It shows on the dashboard as set in the group by that person, where admins can edit or cancel it.

## Proposed decisions (owner to confirm)
| # | Proposal | Recommendation |
|---|---|---|
| P21 | **How "yes" is recognised:** the whole message (after removing an @mention of the bot, spaces and end punctuation, any case) is one of *yes, y, confirm, ok, okay, yeah, yep* or *no, n, cancel, stop*. It works as a plain message, a reply to the confirmation, or a tag. "yes please" or "yes but make it 4pm" does not count (the bot never guesses). | Yes |
| P22 | **Confirming is one database step** (`confirm_reminder_request`, migration 0013): it checks the request is still awaiting, not expired and from this person, creates the reminder and links it, all at once. A double "yes" can never create two reminders. | Yes |
| P23 | **Late "yes":** if the person says yes/no up to 10 minutes after their request expired, the bot replies *"That request has expired, so nothing was set. Tag me again to set it."* rather than staying silent (so nobody thinks it was set). | Yes |
| P24 | **Earliest time: 3 minutes ahead** (room for the 2-minute confirmation). Latest: 1 year. Text: 1–500 characters (spec). | Yes |
| P25 | **Authorized users page:** list with name, number, groups and an on/off switch; add / edit (name, phone in international format, all groups or chosen groups) and delete with confirmation. Owner and staff (permissions matrix). | Yes |
| P26 | **Dashboard shows who set a group reminder:** "Set in the group by +234 801 234 5678" on its row in Upcoming / History. Admins can edit or cancel it like any other post. | Yes |

## Tasks

### 6.1 Authorized users page
- `/authorized-users`: table (cards on mobile) of name, number (`formatPhoneForDisplay`), groups ("All groups" or names), active switch, edit, delete. Empty state explains what authorized users can do.
- `AuthorizedUserDialog` with `<PhoneInput>` (new shared component: accepts spaces and dashes, shows the E.164 result and errors) and an all-groups switch with group checkboxes.
- Server actions `upsertAuthorizedUser` (insert or update the user, replace their group links), `setAuthorizedUserActive`, `deleteAuthorizedUser`; audited (`authorized_user_added` / `_updated` / `_deleted`). A duplicate number gets "This number is already on the list."

### 6.2 Permission check
- `reminders/permission.ts`: pure `canCreateReminder(groupPermission, senderPhone, authorizedUsers, groupId)` → `allowed` | `not_authorized` | `no_phone`.
- `db/authorizedUsersRepo.ts`: active authorized users with their groups, read fresh per reminder request (rare, so no cache).

### 6.3 Parsing and validation
- The classifier's `create_reminder` output is validated by code: `confidence: low`, an unreadable time, under 3 minutes ahead or over 1 year → the `unclearTime` / `tooSoon` / `tooFar` reply, nothing saved. Text trimmed, 1–500 characters.
- The confirmation shows weekday, date, time and the timezone abbreviation, so a misread day is caught by the person before anything is saved.

### 6.4 Confirmation state machine
- `reminders/reminderFlow.ts`:
  - **request:** supersede this person's older awaiting request in this group, insert the new one (`expires_at` = now + 2 min), send the confirmation quoting their message, store its message ID. Audit `reminder_requested`.
  - **possible confirmation** (P21 words only, so normal chat costs nothing): look up this person's awaiting request in this group → yes: `confirm_reminder_request` → reply `reminderSet`, audit `reminder_confirmed`; no: decline → `reminderCancelled`, audit `reminder_declined`. No awaiting request but one expired in the last 10 minutes → `requestExpired` (P23). Otherwise the message is ordinary chat (or an ordinary tag).
- **Routing** (`ingest/handleInbound.ts`, `assistant/pipeline.ts`): every stored staff message whose text is a P21 word goes through the group's queue to the confirmation check *before* the tag pipeline, so replies stay in order and a tagged "yes" is never treated as a question.
- **Expiry:** scheduler tick step 2 marks awaiting requests past `expires_at` as `expired` (audit `reminder_expired`); no message is sent. The confirm function also refuses expired requests, so a slow tick can never let a late "yes" through.

### 6.5 Refusals
- Templates: `notAuthorized` ("Sorry, only authorized team members can set reminders here."), `noPhone` ("I can't see your number, so I can't check whether you can set reminders here. Please ask an admin."), `unclearTime`, `tooSoon` ("That's too soon to set. Pick a time at least a few minutes from now."), `tooFar`, `confirmReminder`, `reminderSet`, `reminderCancelled`, `requestExpired`; `dashboardOnly` for edit / cancel / repeating / announcements (unchanged). `remindersNotYet` is removed.
- Audit `refused_unauthorized` (detail `reason`: `not_authorized` / `no_phone`), `reminder_unclear` (`reason`).

## Database (migration `0013_tag_reminders.sql`)
- `confirm_reminder_request(p_request_id uuid, p_requester_jid text) returns uuid` (P22): in one statement, `awaiting` + not expired + same requester → `confirmed`, insert the `scheduled_posts` row (`kind = 'reminder'`, `created_via = 'group'`, `created_by_phone_e164`), set `scheduled_post_id`; returns the post id, or null if nothing was confirmed. `security definer`, `service_role` only.
- Check on `pending_reminder_requests.draft_body` length 1–500.
- Regenerate `database.types.ts`.

## Files
**Shared:** `src/reminders.ts` (confirmation words, `normalizeReplyWord`, limits, + test), `src/schemas/authorizedUser.ts` (input with `id`), `src/database.types.ts`.
**Worker:** `src/reminders/permission.ts` (+ test), `src/reminders/reminderFlow.ts` (+ test), `src/db/authorizedUsersRepo.ts`, `src/db/reminderRequestsRepo.ts`, `src/assistant/pipeline.ts` (+ test: `create_reminder` and routed confirmations), `src/ingest/handleInbound.ts` (+ test: routing), `src/assistant/templates.ts`, `src/scheduler/scheduler.ts` (+ test: expiry step), `src/index.ts`.
**Dashboard:** `app/(app)/authorized-users/page.tsx`, `components/authorized-users/*` (+ tests), `components/PhoneInput.tsx` (+ test), `server/actions/authorizedUsers.ts` (+ test), `lib/audit.ts` (+ test), `components/schedule/ScheduleList.tsx` + `lib/schedule.ts` ("Set in the group by …", P26).
**Database:** `supabase/migrations/0013_tag_reminders.sql`.

## Docs to update
- `progress.md`: Phase 6 tasks, session log, ADR-035 (confirmation words, atomic confirm, late-"yes" reply), remove the `[DEFAULT]` on the silent expiry if P23 is approved.
- `data-models.md`: §3.8 check, §5 `confirm_reminder_request`.
- `api-interfaces.md`: §3 authorized-user actions, §4.1 reminder audit actions, §5.3 final flow, §5.4 templates, §8 `reminders/` contracts, §8.1 step 2.
- `architecture.md`: §2 `reminders/` folder; §4 step 5 (pending confirmation) now implemented.
- `ui-context.md`: `/authorized-users`, `<PhoneInput>` ✅, schedule row label.

## Alternatives considered
- **Let the AI decide whether "yes" is a confirmation:** costs an AI call per message and could misread; a fixed word list is predictable and free.
- **Confirm in two separate writes from the worker:** a crash between them could leave a confirmed request with no reminder, or a double "yes" could create two; one database function avoids both.
- **Trust WhatsApp group-admin status instead of the list:** rejected by ADR-006 (the owner controls the list).
- **Stay silent on a late "yes" (current default):** the person may believe the reminder was set (overview §6: never claim something not done, and don't leave people guessing).

## Risks / open questions
- **Hidden phone numbers.** WhatsApp increasingly shows group members by an anonymous ID. When the bot can't map it to a number, an admins-only group refuses that person ("I can't see your number…"). I could not measure how common this is (the database was unreachable from here); the dashboard's Messages tab shows a number for senders the bot can see. If it is common, the group can switch to *any member*, or a later phase can match authorized users by WhatsApp ID as well. **Please check one or two staff in the Messages tab before the live test.**
- **AI date mistakes** ("next Friday" vs "this Friday"): mitigated by the full date in the confirmation and the requester-only "yes".
- **A reminder set in a paused group** waits, like dashboard posts (Phase 5).

## Verify
**Automated**
- Permission: any-member, admins-only with the number listed (all groups / this group / another group / turned off), no number.
- Validation: low confidence, past, under 3 minutes, over a year, empty or long text.
- Flow: request → confirmation sent and stored; yes / no from the requester; yes from someone else ignored; tagged "yes" and reply-to-confirmation "yes" consumed, not answered as questions; second request supersedes the first; double "yes" creates one reminder; late "yes" within 10 minutes gets the expired reply; expiry marks requests; ordinary chat never touches the database.
- Dashboard: authorized-user dialog, phone input, actions (roles, duplicate number, group links), audit labels, "Set in the group by".
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, dashboard build.

**Live (owner, in "Softwirelex group")**
1. Group set to *admins only*; you are **not** on the list → tag a reminder → polite refusal.
2. Add yourself on Authorized users → tag "@bot remind us tomorrow 10am to send the report" → confirmation with the full date → "yes" → "Done…" → it appears in Upcoming as set in the group by you.
3. Another member replies "yes" to a new request → nothing happens; you reply "no" → cancelled.
4. Request again and wait over 2 minutes, then say "yes" → "That request has expired…".
5. "@bot remind us every Monday…" → "That can only be done from the dashboard."
6. At the time, the reminder is posted.

## Out of scope for this step
- Editing, cancelling or repeating reminders from the chat (dashboard only, by design).
- Reminders that @mention people.
- Matching authorized users by WhatsApp anonymous ID (possible later if numbers are often hidden).

## Exit criteria (from progress.md)
- An authorized user creates a reminder end-to-end; others are refused; nothing is saved without "yes"; expired requests leave no reminder.
- All checks pass and the docs above are updated.
