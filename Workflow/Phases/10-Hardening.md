# Step 10 — Phase 7: Hardening (and Moving the Worker to Railway)

> Covers `progress.md` Phase 7, tasks **7.1–7.4**, plus a new task **7.0** (deploy the worker to Railway; owner choice 2026-10-24).
> Status: **approved 2026-10-24** with P35 revised to be host-neutral (the owner asked not to build around Railway) and P36–P40 as written.
> Branch: `phase-7`, created from `main` (Phase 6 merged in PR #6). One commit per task.

## Goal
The bot runs on a server that is always on with a stable connection, instead of the owner's PC. Changing the bot's number is guided by a checklist, a burst of tags is handled correctly, and the owner has written steps for backups and for the things that can go wrong.

## Why the worker should move now
On 2026-10-24 the worker, running on the owner's PC, lost Supabase and WhatsApp repeatedly (`fetch failed`, WhatsApp 408/428), stepped down and recovered several times, and one tag went unanswered. A server with a stable network fixes most of that. The design always assumed an always-on host (architecture.md §1, README "Deploy").

## Proposed decisions (owner to confirm)
| # | Proposal | Recommendation |
|---|---|---|
| P35 | **Host-neutral:** the worker ships as a standard **Dockerfile** (Node 24, pnpm, the worker only, ffmpeg included) that runs on any always-on host. The README lists what any host must provide, with **Railway as the first worked example** (settings entered on Railway's website, no Railway file in the repository) and short notes for Fly.io and a plain server with Docker. Nothing Railway-specific in the code. The dashboard stays on Vercel. | Yes (revised at the owner's request) |
| P36 | **Safe deploys:** exactly 1 copy; the host gives the old worker 15 s to stop (on Railway: `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15`) so it releases the leader lock and saves the WhatsApp session before the new one takes over. If both briefly run, the leader lock already guarantees only one connects (ADR-010). | Yes |
| P37 | **Region:** the Railway region closest to the Supabase project's region (the owner reads it on Supabase → Project Settings → General), to keep database calls fast. | Yes |
| P38 | **After a number change, groups come back on their own:** groups that were active or paused before a relink return to that status automatically when the new number is added to them (no re-approval; training and settings are kept). A group the bot is removed from for any other reason still comes back as Pending, as today. | Yes |
| P39 | **Owner-facing runbook** as a new file `RUNBOOK.md` at the repository root (next to the README), in plain steps. | Yes |
| P40 | **Backups on the free Supabase plan:** Supabase does not keep downloadable backups on the free plan, so the runbook gives a manual weekly backup (one command) and how to restore; upgrading to Supabase Pro (daily backups) is noted as the option when the bot becomes important. | Yes |

## Tasks

### 7.0 Deploy the worker to Railway
- `apps/worker/Dockerfile` (+ root `.dockerignore`): Node 24 slim, pnpm via corepack, installs only the worker and the shared package (`pnpm install --frozen-lockfile --filter worker...`), runs `pnpm --filter ./apps/worker start`. The ffmpeg binary downloads during the build (Railway has normal internet).
- No host-specific file: the host settings (1 copy, restart on failure, no public networking, no health-check URL since the worker has no web server; the heartbeat and offline email already cover health) are listed in the README.
- `README.md` "Deploy" → "Run the worker on any host" (the four requirements: always on, one copy, ~15 s to stop on redeploy, internet and environment variables), then a step-by-step Railway setup: create the project from GitHub, set the root and Dockerfile, add the worker variables (listed), set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15`, pick the region, deploy. Then **stop the worker on the PC** (it would otherwise compete for the lock).
- No code change needed for the session: it is stored encrypted in Supabase, so the Railway worker continues the same WhatsApp login **without re-pairing** (same `SESSION_ENCRYPTION_KEY` required).
- Logs: plain JSON lines in Railway's log view (already the production format).

### 7.1 Relink re-admission checklist
- Migration `0015_relink_readmission.sql`: `groups.status_before_relink` (the status a group had when the number was changed) and `groups.relinked_at`.
- Worker: when a relink succeeds, active and paused groups are marked with their status and time. When the new number appears in such a group, it returns to that status (audit `group_readmitted`); the marks are cleared. Groups not re-added stay `removed` and keep their marks.
- Dashboard: **Connection** page shows "Add the new number to these groups" after a relink, each group ticking off as it comes back, with a count. The **Groups** list shows "Waiting for the new number" on those groups.

### 7.2 Load test: 5 tags at once
- An automated test that drives the real pipeline (fake WhatsApp, fake AI with varied delays): 5 tagged messages arrive in the same group at the same moment → 5 replies, in arrival order, each quoting its own question, never interleaved, each with its own audit row; a second group in parallel is not held up.
- A live checklist in the runbook: 5 people tag the bot within a few seconds; expected result and what to look at in the Audit log.

### 7.3 Backup and restore notes (in `RUNBOOK.md`)
- What must be kept safe: the Supabase database (all data and the encrypted WhatsApp session), the attachment files, and `SESSION_ENCRYPTION_KEY` (without it the session can't be read; the bot would need relinking).
- Weekly backup: `pnpm supabase db dump` commands (schema and data) and downloading the `post-attachments` bucket; where to keep the files.
- Restore: into a new Supabase project (migrations, then the data), update the worker and dashboard variables; if the session can't be restored, relink from the dashboard.

### 7.4 Runbook (in `RUNBOOK.md`)
Plain steps for: **number banned or logged out** (spare SIM, relink, the 7.1 checklist); **worker down** (the offline email, Railway logs and restart, a crash loop, the PC copy still running); **OpenRouter outage or no credit** (what the group sees, checking credit, changing the models in Settings); **Supabase unreachable**; **Railway trial ending** (what happens and how to keep it running); **posts in Needs attention** (when to Resend).

## Files
**Deploy:** `apps/worker/Dockerfile`, `.dockerignore`, `README.md`.
**7.1:** `supabase/migrations/0015_relink_readmission.sql`; worker `src/db/groupsRepo.ts`, `src/ingest/groupDirectory.ts` (+ test), `src/pairing/pairingWatcher.ts` (+ test) or `src/whatsapp/connection.ts` (whichever learns the relink succeeded), `src/index.ts`; dashboard `app/(app)/connection/*` (checklist, + test), `app/(app)/groups/page.tsx`, `lib/groups.ts`, `lib/audit.ts`; `packages/shared/src/database.types.ts`.
**7.2:** `apps/worker/src/assistant/loadTest.test.ts`.
**7.3–7.4:** `RUNBOOK.md`.

## Docs to update
- `progress.md`: Phase 7 tasks (7.0 added), session log, ADR-037 (Railway hosting and safe deploys), ADR-038 (automatic re-admission after a relink).
- `architecture.md`: §1 worker host = any always-on Docker host (Railway first); §5 deploy settings; §8 where the variables live.
- `data-models.md`: the two `groups` columns.
- `api-interfaces.md`: relink and re-admission, `group_readmitted` audit action.
- `ui-context.md`: Connection checklist, Groups badge.
- `project-overview.md`: none (the checklist is already in §4.6).

## Alternatives considered
- **Building around Railway (a `railway.json`, Railway's automatic build):** ties the project to one host; the owner asked to keep it portable. Railway's automatic build is also less to write, but a pnpm monorepo with a workspace package and a binary download is easy to get subtly wrong; a Dockerfile is explicit and portable to Fly.io later.
- **Keep running on the PC with WARP:** free, but today's logs show it isn't reliable enough for scheduled posts and reminders.
- **Re-approve every group after a relink (current behaviour):** safe but tedious for a routine number change; P38 restores only groups that were already approved.

## Risks / open questions
- **Railway trial:** about one month free; after that the Hobby plan (about $5/month) is needed or the worker stops. The runbook says how to tell and what to do.
- **WhatsApp from a server address:** the same linked-device session now connects from a data-centre IP. Baileys bots normally run this way; if WhatsApp ever logs the session out, the existing alert email and relink flow cover it.
- **Region latency** to Supabase if the regions differ (P37).
- **One worker only:** the PC copy must be stopped after the move; if it isn't, the lock keeps one of them idle, but alerts and logs get confusing.

## Verify
**Automated:** re-admission (relinked active / paused group comes back with its status; a genuinely removed group comes back pending; marks cleared); the checklist renders and ticks off; the 5-tag load test; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, dashboard build; `docker build` of the worker image succeeds.

**Live (owner):**
1. Railway: deploy; logs show `lock acquired`, `connected to WhatsApp`; the dashboard shows Connected; the PC worker is stopped.
2. Tag the bot and schedule a post 2 minutes ahead: both work from Railway.
3. Redeploy on Railway: the bot reconnects within about a minute, no duplicate posts, no offline email.
4. Five people tag the bot within a few seconds: five correct replies in order.
5. (Optional, with a spare SIM) Relink: the checklist lists the groups; adding the new number to one ticks it off and it is active again without re-approval.
6. Run the weekly backup command once and check the files exist.

## Out of scope for this step
- Running more than one worker, or automatic failover between hosts.
- Paid Supabase backups (noted as an option only).
- CI pipelines and automated tests on GitHub (revisit later, per ADR-021).

## Exit criteria
- The worker runs on Railway with one instance and safe deploys; the PC copy is off.
- Relink re-admission works with the checklist.
- The 5-tag load test passes.
- `RUNBOOK.md` covers backups, restore and the listed incidents.
- All checks pass and the docs above are updated.
