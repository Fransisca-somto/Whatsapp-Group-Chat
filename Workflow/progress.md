# Progress Tracker

> The project's living logbook. **Read at the start of every session. Update at the end of every task.**
> Status keys: ⬜ Not started · 🟦 In progress · ✅ Done · ⛔ Blocked · ⏸️ Deferred

---

## Current State

| Field | Value |
|---|---|
| **Current phase** | Phase 1 — Worker Connection & Pairing (Phase 0 ✅) |
| **Current task** | 1.5 Reconnect policy, then 1.4 pairing (1.1–1.3 ✅; live tests pending service-role key) |
| **Blockers** | None |
| **Last updated** | 2026-10-18 (Phase 1 plan approved; 1.1 worker boot done) |

---

## Phases & Milestones

Phases run in order. Do not start a phase until the previous one is ✅, unless the owner explicitly approves.

### Phase 0 — Foundations ✅
- ✅ 0.1 Monorepo with pnpm workspaces: `apps/dashboard`, `apps/worker`, `packages/shared`.
- ✅ 0.2 TypeScript strict, ESLint, Prettier, Vitest configured in all packages.
- ✅ 0.3 Supabase project linked; pgvector enabled; initial migration with all tables in `data-models.md`.
- ✅ 0.4 RLS policies per `data-models.md` §4.
- ✅ 0.5 Dashboard shell: auth (login/logout), layout, sidebar, design tokens, `<StatusBadge>`.
- ✅ 0.6 Shared zod schemas and time helpers (`packages/shared`).
- **Exit criteria:** owner can log in to an empty dashboard; migrations apply cleanly on a fresh database.

### Phase 1 — Worker Connection & Pairing 🟦
- ✅ 1.1 Worker boot with env validation and structured logging.
- ✅ 1.2 Leader lock (acquire, renew, release, self-fence on failed renewal).
- ✅ 1.3 Encrypted Supabase auth-state adapter with debounced writes.
- ⬜ 1.4 Pairing flow via `pairing_requests` (pair + relink).
- ⬜ 1.5 Reconnect policy per `architecture.md` §7.
- ⬜ 1.6 Heartbeat + `<WorkerStatus>` + `/connection` page with `<PairingCodeCard>`.
- ⬜ 1.7 Owner alerts via Meta Cloud API (logged out, offline >5 min, repeated failures).
- **Exit criteria:** owner links the number from the dashboard; worker survives restart without re-pairing; killing the worker shows offline within 60 s and alerts within 5 min; a second worker instance cannot connect.

### Phase 2 — Groups & Message Ingestion ⬜
- ⬜ 2.1 Detect groups the bot is in; create as `pending`.
- ⬜ 2.2 `/groups` page with approve / pause / archive; group settings page.
- ⬜ 2.3 Store messages from active groups only; dedupe by WhatsApp message ID.
- ⬜ 2.4 Tag detection (@mention or reply to bot); ignore private chats.
- ⬜ 2.5 Handle bot removed from group → status `removed`, pause its scheduled posts.
- **Exit criteria:** messages from approved groups appear in the group page; pending groups store nothing.

### Phase 3 — Tagged Q&A ⬜
- ⬜ 3.1 Knowledge base CRUD in dashboard.
- ⬜ 3.2 OpenRouter client with timeout, retry, fallback model.
- ⬜ 3.3 Intent classification with zod-validated JSON output.
- ⬜ 3.4 Answer generation using knowledge + last 15 messages; "I don't know" behavior.
- ⬜ 3.5 Typing delay, send queue, rate limits, daily caps, `ai_usage` tracking.
- ⬜ 3.6 `bot_actions` audit log + `/audit` page.
- **Exit criteria:** tagging the bot gets a correct, short answer; untagged messages get nothing; injection attempts ("ignore your instructions...") do not change permissions.

### Phase 4 — Deep History (Hybrid Search) ⬜
- ⬜ 4.1 Embedding pipeline for messages and knowledge (background, batched, retry on failure).
- ⬜ 4.2 `search_group_history` and `search_knowledge` SQL functions (vector + full-text, reciprocal rank fusion).
- ⬜ 4.3 Retrieval wired into answers; search strictly scoped to the asking group.
- ⬜ 4.4 Retention job honoring `groups.retention_days`.
- **Exit criteria:** "what did we decide about the reports on Monday?" finds the right messages by meaning and by keyword; no cross-group leakage (tested).

### Phase 5 — Scheduler & Dashboard Scheduling ⬜
- ⬜ 5.1 `/schedule` page: create / edit / cancel announcements and reminders, including recurring.
- ⬜ 5.2 30-second poller with atomic claiming.
- ⬜ 5.3 Late handling (≤2 h send with note; >2 h skip) and delivery-uncertain recovery.
- ⬜ 5.4 Recurrence: next occurrence created after each send.
- ⬜ 5.5 "Needs attention" tab with Resend for uncertain items.
- **Exit criteria:** posts arrive within 30 s of due time; crash-and-restart never produces a duplicate.

### Phase 6 — Tag-to-Create Reminders ⬜
- ⬜ 6.1 Authorized users page (name, phone, scope).
- ⬜ 6.2 Per-group permission toggle enforcement (admins only / any member).
- ⬜ 6.3 Reminder parsing in company timezone; code validation.
- ⬜ 6.4 Confirmation state machine (requester only, yes/no, 2-minute expiry, one pending per user per group).
- ⬜ 6.5 Polite refusals for unauthorized users and dashboard-only requests (edit, cancel, recurring).
- **Exit criteria:** authorized user creates a reminder end-to-end; others are refused; nothing saved without "yes"; expired requests leave no reminder.

### Phase 7 — Hardening ⬜
- ⬜ 7.1 Relink re-admission checklist.
- ⬜ 7.2 Load test: 5 simultaneous tags in one group handled serially and correctly.
- ⬜ 7.3 Backup/restore notes for session and data.
- ⬜ 7.4 Runbook: banned number, worker down, OpenRouter outage.

### Future (gated, do not start without owner approval) ⏸️
- ⏸️ **Customer mode** — requires Phase 7 ✅, a consent and retention decision, and a ban-risk review.
- ⏸️ Reminders that @mention specific people.
- ⏸️ Media understanding (images, voice notes).

---

## Architecture Decision Records (ADRs)

Format: `ADR-NNN — Title · Date · Status` then Context / Decision / Consequences. Never delete an ADR; supersede it.

**ADR-001 — Use Baileys for group messaging · 2026-10-03 · Accepted**
Context: The official API does not meet the group-bot need. Decision: Use Baileys on a dedicated number, staff groups only for now. Consequences: Ban risk accepted; relink flow, alerts and conservative sending required.

**ADR-002 — Lookup, not fine-tuning · 2026-10-03 · Accepted**
Decision: The AI receives company knowledge and retrieved history at answer time. No model training. Consequences: Knowledge changes take effect immediately; no training cost.

**ADR-003 — Store full group history; retrieve selectively · 2026-10-03 · Accepted**
Decision: All messages from active groups are stored. Each reply uses the last 15 messages plus top relevant results from hybrid search. Consequences: Deep memory at controlled cost; privacy decision required before customer mode.

**ADR-004 — Hybrid search (semantic + keyword) · 2026-10-03 · Accepted**
Decision: pgvector + Postgres full-text, fused with reciprocal rank fusion.

**ADR-005 — Shared company brain, isolated group records · 2026-10-03 · Accepted**
Decision: One knowledge base for all groups; messages, reminders, settings and logs are per group and never cross.

**ADR-006 — Own authorized-user list keyed by phone number · 2026-10-03 · Accepted**
Decision: Bot permissions come from the dashboard list, not WhatsApp group-admin status. Consequences: Senders without a resolvable phone number are treated as unauthorized.

**ADR-007 — Per-group reminder permission toggle · 2026-10-03 · Accepted**
Decision: Each group can be "admins only" (default) or "any member".

**ADR-008 — Reminder creation split · 2026-10-03 · Accepted**
Decision: One-off reminders can be created by tag with requester-only "yes" confirmation (2-minute expiry). Editing, cancelling and recurring reminders are dashboard-only.

**ADR-009 — Single company timezone · 2026-10-03 · Accepted**

**ADR-010 — Leader lock + stop-before-start deploys · 2026-10-03 · Accepted**
Decision: Supabase lease lock guarantees one WhatsApp connection.

**ADR-011 — At-most-once delivery for scheduled posts · 2026-10-03 · Accepted `[DEFAULT]`**
Decision: Items stuck mid-send after a crash become "delivery uncertain" with manual Resend, never auto-resent. Late window 2 h.

**ADR-012 — Dashboard ↔ worker via Supabase only · 2026-10-03 · Accepted**
Decision: No direct HTTP between dashboard and worker; tables + Realtime.

**ADR-013 — AI proposes, code authorizes · 2026-10-03 · Accepted**

**ADR-014 — Plan-before-build workflow for agents · 2026-10-03 · Accepted**
Decision: Agents must present a plan and receive approval before writing code (see `CLAUDE.md`).

**ADR-015 — Next.js (not Vite) for the dashboard · 2026-10-08 · Accepted**
Context: The worker exposes no HTTP API (ADR-012), so a browser-only Vite app would have no trusted server layer. Decision: Keep Next.js. Server actions validate input with zod, re-check the user's role and hold the service-role key. Consequences: Role checks and validation stay in TypeScript instead of SQL or Edge Functions. Vite remains possible later if RLS-only access proves enough.

**ADR-016 — Agents never run terminal commands · 2026-10-08 · Accepted**
Decision: Per the owner's instruction in `Workflow/Phases/01-Codebase-Setup.md`, agents write and edit files but hand every terminal command to the owner, who runs it and reports the output. Consequences: Setup steps are paused at each command; verification is based on the owner's pasted output.

**ADR-017 — Tooling baseline · 2026-10-08 · Accepted `[DEFAULT]`**
Decision: Node 24, `pnpm@12.10.1` pinned in the root `package.json`, `tsx` for the worker dev runner, package scope `@soft-agent-support/*` (owner-chosen, 2026-10-08). Shared package is consumed as TypeScript source (no build step). Consequences: Dashboard will need `transpilePackages` once it imports real code from `@soft-agent-support/shared`.

**ADR-018 — TypeScript 5.9 and Node 24 types across the monorepo · 2026-10-08 · Accepted**
Context: pnpm resolved TypeScript 7 and `@types/node` 26 for the worker and shared package, while the dashboard (Next.js 16) uses TypeScript 5.9 and the runtime is Node 24. Decision: Use TypeScript `~5.9.3` everywhere and `@types/node` `^24`. Consequences: One compiler version across packages; types match the Node runtime. Revisit TypeScript 7 once ESLint, Vitest and Baileys tooling support it.

**ADR-019 — Database conventions · 2026-10-08 · Accepted**
Decision: One hosted Supabase project (no Docker, no rehearsal project; the empty real project is the fresh-database test). Seven migrations by concern (`0001`–`0007`). `public.current_role()` renamed to `current_dashboard_role()` (reserved keyword). Guard triggers enforce append-only `bot_actions` and restricted updates on `group_messages`, because the service-role worker bypasses RLS. Worker-only functions are executable by `service_role` only. Every RLS policy requires a non-null dashboard role, so a stray Supabase sign-up sees nothing. Consequences: `data-models.md` updated; new schema changes ship as new numbered migrations, never edits to applied ones.

**ADR-020 — One WhatsApp number per deployment · 2026-10-08 · Accepted**
Decision: The system serves one number in many groups. Single-row tables (`wa_connection`, `worker_lock`, `company_settings`) and one `wa_auth_state` encode this. A second bot number is handled by cloning the repository with its own Supabase project and worker. Consequences: full isolation between bots; multi-number in one system would need an account column across most tables and is out of scope.

**ADR-021 — Tooling baseline for quality checks · 2026-10-09 · Accepted**
Decision: TypeScript adds `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch` on top of `strict` (not `exactOptionalPropertyTypes`, which clashes with generated Supabase types). Worker and shared use type-aware ESLint (`no-floating-promises`, `no-misused-promises`, `no-explicit-any`, no default exports); the dashboard keeps Next's ESLint config plus Prettier compatibility. Prettier formats code; `Workflow/`, `CLAUDE.md`, `supabase/` and generated files are ignored. Vitest runs in every package with tests next to the code. No git hooks and no CI for now. Consequences: a forgotten `await` fails lint; revisit hooks and CI before Phase 7 (needs a new ADR).

**ADR-022 — Dashboard login and access gate · 2026-10-18 · Accepted `[DEFAULT]`**
Decision: Dashboard login is Supabase Auth email + password; public sign-ups stay disabled and users are created by hand in Supabase (Authentication → Users, plus a `dashboard_users` row). `proxy.ts` only redirects signed-out visitors; the real gate is `server/currentUser.ts`, which signs out any user without a valid `dashboard_users` role via `/auth/signout?reason=no_access`. Owner-only nav items are hidden for staff, with RLS and server actions as the enforcement. Consequences: no password reset, invitations or magic links yet; adding users from the dashboard is a future task.

**ADR-023 — Agent may run terminal commands · 2026-10-18 · Accepted (supersedes ADR-016)**
Context: ADR-016 had the owner run every command; this was already set aside in the 0.5/0.6 session. Decision: The owner authorized the agent to run terminal commands (installs, checks, migrations) when starting Phase 1. Consequences: verification output is gathered by the agent and reported in the session log. Destructive or outward-facing commands (pushing to GitHub, deleting data) still need explicit approval.

**ADR-024 — Env variables required by phase · 2026-10-18 · Accepted**
Context: `architecture.md` §8 required every worker variable on boot, so the worker could not start in Phase 1 without OpenRouter and Meta keys. Decision: a variable becomes required in the task that first uses it (Supabase + session key in 1.1, Meta in 1.7, OpenRouter/embeddings in Phase 3); before that it is optional but format-checked. Consequences: each of those tasks must flip its variables to required in `apps/worker/src/env.ts`.

---

## Open Defaults to Confirm

Sensible defaults applied during the spec session. The owner should confirm or change each; then remove `[DEFAULT]` from the relevant doc.

| # | Default | Where |
|---|---|---|
| D1 | Tag = @mention or reply to a bot message (name alone doesn't count) | overview §4.2 |
| D2 | Bot says "I don't know" rather than guessing | overview §4.2 |
| D3 | Persona, reply in user's language, one-line decline for abuse/off-topic | overview §6 |
| D4 | Rate limits: 5 tags/user/minute; 200 replies/group/day | architecture §4 |
| D5 | Late window 2 h; at-most-once delivery | overview §4.4 |
| D6 | Offline = no heartbeat for 60 s; alert after 5 min | overview §4.7 |
| D7 | Dashboard roles owner/staff; only owner relinks | overview §2 |
| D8 | Private chats ignored; media stored as metadata only | overview §7 |
| D9 | Embedding model `text-embedding-3-small` | architecture §1 |
| D10 | Retention: keep forever unless set per group | data-models §3 |
| D11 | Visual system (colors, fonts) | ui-context |

---

## Session Log

Newest first. One entry per working session.

```
### YYYY-MM-DD — <agent or person>
- Task(s): <ids>
- Done: <what was completed>
- Changed docs: <which files>
- Decisions: <ADR ids, if any>
- Next: <what should happen next>
- Notes / issues: <anything the next session must know>
```

### 2026-10-18 — Claude (dashboard shell and shared schemas)
- Task(s): 0.5, 0.6 (step 04, `Workflow/Phases/04-Dashboard-Shell.md`)
- Done: Files were written between 2026-10-11 and 2026-10-17 but not logged until now. Shared package: `time.ts` (company-timezone formatting, zoned/UTC conversion, next weekday occurrence) and `schemas/` (phone, enums, group settings, authorized user, intent with fallback, login), tested in `Africa/Lagos` and a DST zone. Dashboard: Supabase browser/server clients, `proxy.ts`, login page and actions, `/auth/signout` route, role gate (`server/accessDecision.ts`, `server/currentUser.ts`), tokens and fonts, `AppShell`/`Sidebar`/`UserMenu`, eight placeholder pages, `StatusBadge`, `PageHeader`, `EmptyState`, `DateTimeInCompanyTz`, shadcn primitives, Vitest with jsdom and Testing Library.
- Verified: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (shared 27, dashboard 26), `pnpm format:check`, `pnpm --filter dashboard build` all pass (run by the agent at the owner's request this session). Signed-out requests to `/`, `/groups`, `/settings`, `/connection` redirect to `/login`. Owner confirmed in the browser: owner sees all 8 items and logout works; staff does not see Connection or Settings; a user with no `dashboard_users` row is rejected and signed out; mobile drawer and dark mode work; staff pages load without RLS errors.
- Changed docs: `architecture.md` (UI, forms, auth, time, test rows), `ui-context.md` (token mapping via `@theme inline`, built components, `AppShell`), `progress.md`.
- Decisions: ADR-022.
- Next: Phase 1. Plan 1.1 (worker boot, env validation, pino logging), then 1.2 leader lock.
- Notes / issues:
  - Test accounts: staff user created in Supabase Auth with a `staff` row; a no-role test user may still exist in Auth (safe to delete).
  - Dashboard Vitest prints a harmless warning about ESM in `vitest.config.ts`; renaming it to `vitest.config.mts` would silence it.
  - ADR-016 (agent never runs commands) was set aside this session at the owner's request; the owner has not yet decided whether to supersede it.
  - The repository has no commits yet.

### 2026-10-09 — Claude (tooling setup)
- Task(s): 0.2 (step 03, `Workflow/Phases/03-Tooling-Setup.md`)
- Done: Added ESLint (root config for worker and shared, type-aware; dashboard keeps Next's config), Prettier, and Vitest in all three packages. Three extra TypeScript flags in `tsconfig.base.json`; dashboard tsconfig now extends it. Added `typecheck`, `lint`, `test` scripts everywhere and `format` / `format:check` at the root. One smoke test in `packages/shared`. Dashboard aligned to TypeScript `~5.9` and `@types/node` 24; its nested `packageManager` field removed. A temporary canary file confirmed lint fails on an un-awaited promise, an explicit `any` and a default export, then was deleted. `pnpm format` normalised two dashboard files (cosmetic).
- Verified by the owner: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, `pnpm --filter dashboard build` all pass.
- Changed docs: `architecture.md` (tooling rows, coding conventions), `progress.md`.
- Decisions: ADR-021.
- Next: remaining Phase 0 tasks: 0.5 dashboard shell (Supabase Auth login, layout, sidebar, design tokens, StatusBadge) and 0.6 shared zod schemas and time helpers. 0.6 has no dependencies on 0.5, so either can go first; 0.5 needs `ui-context.md` decisions (Open Default D11, visual system).
- Notes / issues: Dashboard test and component-test setup (jsdom, Testing Library) is deferred to 0.5. Dependency versions are current as of this date (vitest 5, eslint 9, prettier 3).

### 2026-10-08 — Claude (database setup)
- Task(s): 0.3, 0.4 (step 02, `Workflow/Phases/02-Database-Setup.md`)
- Done: Supabase CLI added and project linked; seven migrations (`supabase/migrations/0001`–`0007`) and `supabase/seed.sql` written; migrations pushed and seed run by the owner. Verified in the SQL Editor: 16 tables, RLS on for all 16, one `company_settings` row, one owner, `acquire_worker_lock` true then false (lock reset afterwards), `bot_actions` update blocked by the append-only trigger.
- Changed docs: `data-models.md` (role helper rename, guard triggers, function notes), `architecture.md` (Supabase CLI row), `progress.md`.
- Decisions: ADR-019, ADR-020.
- Also done: generated `packages/shared/src/database.types.ts` (`supabase gen types`) and exported its types (`Database`, `Json`, `Tables`, `TablesInsert`, `TablesUpdate`, `Enums`) from `@soft-agent-support/shared`. `pnpm -r typecheck` and the dashboard build pass.
- Next: plan 0.2 (tooling: strict TypeScript, ESLint, Prettier, Vitest). Regenerate the types file after any future migration.
- Notes / issues:
  - "Allow new users to sign up" is OFF in Supabase Auth (confirmed by the owner).
  - RLS tested in the SQL Editor by impersonating roles (rolled-back script): anon is denied everywhere; a signed-in non-dashboard user sees 0 rows and cannot write; staff can manage groups but cannot edit settings, self-promote, create pairing requests or write `bot_actions`; owner can edit settings and create pairing requests but cannot write `bot_actions`; `worker_lock`, `wa_auth_state` and worker-only functions are denied to every dashboard role. Re-test from the real dashboard once login exists (0.5).
  - The offline-alert `pg_cron` job and Edge Function are task 1.7, not part of this step.
  - Local `.env` files: copy `.env.example` to `apps/dashboard/.env.local` and `apps/worker/.env`; the apps do not read a root `.env`.

### 2026-10-08 — Claude (codebase setup)
- Task(s): 0.1
- Done: pnpm monorepo created with `apps/dashboard` (Next.js 16 + TypeScript + Tailwind, builds), `apps/worker` (Node + TypeScript via tsx, prints a boot line) and `packages/shared` (placeholder export, linked into both apps). Root files added: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.nvmrc`, `tsconfig.base.json`, `.env.example`. Git repo initialised at the root. Verified by the owner: `pnpm install`, `pnpm -r typecheck`, `pnpm --filter dashboard build`, worker start.
- Changed docs: `progress.md`, `architecture.md` (tooling rows).
- Decisions: ADR-015 to ADR-017.
- Next: Step 02, database setup (0.3 Supabase + migrations, 0.4 RLS), then 0.2 (strict TS, ESLint, Prettier, Vitest).
- Notes / issues:
  - Docs folder mismatch resolved: the folder stays `Workflow/`; `CLAUDE.md` and `architecture.md` paths were updated to match.
  - Package scope renamed from the `@app` placeholder to `@soft-agent-support`.
  - Versions aligned (ADR-018): TypeScript `~5.9.3` in all packages, `@types/node` `^24` in the worker. Verified with `pnpm -r typecheck`.
  - Dashboard has no `typecheck` or `test` script yet (0.2). Its `AGENTS.md` was generated by Next.js and kept.
  - `create-next-app` runs `git init` and creates its own lockfile and workspace file; these were removed and `allowBuilds` moved to the root `pnpm-workspace.yaml`.
  - Agent workflow rule: no terminal commands run by the agent (ADR-016).

### 2026-10-03 — Spec session
- Task(s): Specification
- Done: Pressure-tested the idea; created `CLAUDE.md` and the six docs.
- Decisions: ADR-001 to ADR-014.
- Next: Owner reviews Open Defaults table, then Phase 0 task 0.1.
