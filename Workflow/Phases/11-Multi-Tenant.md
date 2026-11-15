# Step 11 — Phase 8: Multi-tenant (one app, many owners, each with their own WhatsApp number)

> Covers `progress.md` Phase 8, tasks **8.1–8.5**.
> Status: **approved 2026-11-14** by the owner, with the decisions listed under Context.
> Branch: `phase-8`, created from `phase-7`. One commit per task.

## Context
Today one deployment = one company = one WhatsApp number (ADR-028; single-number ADR at progress.md:167; project-overview §7 lists multi-tenancy as out of scope). Every dashboard login shares that one number, so a "new owner" just joins the existing company. The owner wants real multi-tenancy.

**Owner decisions (2026-11-14):**
- Multi-tenant in one deployment → scope change: remove "Multiple companies / multi-tenancy" from project-overview §7 (owner-approved here).
- A **platform admin** (the current owner) creates each new owner; creating an owner creates a new tenant. No public sign-up.
- 1 owner per tenant, 1 tenant per login. Owners add **staff** to their own tenant from a Team page; staff role is kept.
- Logins get a **temporary password**; people change it from the user menu.
- Current data becomes **tenant #1**, owned by the current owner (who is also platform admin); no re-pairing.
- Each tenant brings its **own OpenRouter key**; alerts go to that tenant owner's email.

**Goal:** Any number of owners, each with their own WhatsApp number, groups, training, AI key, staff and data, fully isolated, run by one worker and one dashboard.
**Phase:** New Phase 8 — Multi-tenant (after Phase 7). Detailed plan saved as `Workflow/Phases/11-Multi-Tenant.md`. Branch `phase-8`. Database backup first (RUNBOOK).

## Approach (each sub-step is its own commit)

### 8.1 Schema + backfill — migration `supabase/migrations/0016_multi_tenant.sql`
- New tables: `tenants (id uuid pk, name, status 'active'|'suspended', created_at)`, `platform_admins (user_id pk → auth.users)`.
- `company_settings` and `wa_connection`: drop the `id = 1` singleton; key by `tenant_id` (pk, FK tenants).
- Add `tenant_id uuid not null` (FK tenants, on delete cascade) to: `dashboard_users, groups, knowledge_entries, authorized_users, authorized_user_groups, group_messages, scheduled_posts, pending_reminder_requests, bot_actions, ai_usage_daily, wa_auth_state, pairing_requests, alerts`. Denormalized on purpose (simple RLS, fast filters). Child tables use composite FK `(group_id, tenant_id) → groups(id, tenant_id)` so a row can never point at another tenant's group; same for `authorized_user_groups` → both parents.
- Re-key uniques: `groups (tenant_id, wa_group_jid)`, `authorized_users (tenant_id, phone_e164)`, `wa_auth_state` pk `(tenant_id, key)`, `alerts (tenant_id, incident_key)`, one open pairing request **per tenant**, one owner per tenant (partial unique `dashboard_users(tenant_id) where role='owner'`).
- Backfill: create tenant #1 from the existing `company_settings` row; stamp every existing row with it; then `not null`. Current owner's user id is inserted into `platform_admins` (looked up from their `dashboard_users` owner row — no hand editing).
- `worker_lock` stays **one global lock**: one worker process holds every tenant's connection, so Rule 4 (never two connections for a number) is still guaranteed by a single lock.
- Functions:
  - New `current_tenant_id()` and `is_platform_admin()` (security definer, like `current_dashboard_role()`).
  - OpenRouter key: Vault secret name becomes `openrouter_api_key:<tenant_id>`; tenant #1's existing secret renamed in the migration. `set/clear_openrouter_key()` use `current_tenant_id()`; `get_openrouter_key(p_tenant_id)` (service role).
  - `claim_due_posts(p_tenant_id, p_claim_token, p_limit)` — claims only that tenant's posts.
  - New `tenant_owner_email(p_tenant_id)` (service role) for alerts.
  - `check_worker_offline()` loops over linked tenants' `wa_connection` rows and emails each affected owner. Resend key + sender stay platform-wide in Vault; global `alert_recipients` is replaced by the per-tenant owner email.
  - `purge_expired_messages`, `confirm_reminder_request`, `attachments_due_for_cleanup`, search functions: already group-scoped; audit rows they write get `tenant_id`.
- RLS: every policy adds `tenant_id = current_tenant_id()`. Storage paths become `<tenant_id>/<uuid>/<name>`; policies check `storage.foldername(name)[1] = current_tenant_id()::text`, with a fallback for existing un-prefixed files that belong to tenant #1's posts.
- Regenerate `packages/shared/src/database.types.ts`; update `supabase/tests/phase4_isolation.sql`.

### 8.2 Dashboard tenant scoping
- `server/currentUser.ts` / `accessDecision.ts` return `tenantId` (+ `isPlatformAdmin`). Suspended tenant → signed out with a message.
- Replace every `.eq("id", 1)` on `company_settings` / `wa_connection` with `.eq("tenant_id", tenantId)`: `server/actions/schedule.ts`, `server/actions/settings.ts`, `server/schedule.ts`, `app/(app)/page.tsx`, `groups/page.tsx`, `groups/[id]/page.tsx`, `knowledge/page.tsx`, `audit/page.tsx`, `connection/page.tsx`, `settings/page.tsx`, `lib/useWorkerConnection.ts`.
- All inserts set `tenant_id`; `server/audit.ts` writes it. Realtime subscriptions (`useWorkerConnection`, `ConnectionPanel`) filter `tenant_id=eq.<id>`. `lib/attachmentUpload.ts` adds the tenant prefix.

### 8.3 Platform admin page, Team page, change password
- `/admin` (only for platform admins; nav item hidden otherwise): tenant list (company, owner, WhatsApp status, created, status). "New owner" dialog → server action with the existing service-role client `lib/supabase/admin.ts`: `auth.admin.createUser(email, temp password, email_confirm: true)` → insert `tenants`, `company_settings`, `wa_connection`, owner `dashboard_users`; on any failure delete the created auth user. Suspend / reactivate tenant.
- `/team` (owner only, new `ownerOnly` item in `components/navItems.ts`): list staff, add staff (name, email, temp password), remove staff (deletes the auth user). Modelled on `components/authorized-users/AuthorizedUsersList.tsx` + `AuthorizedUserDialog.tsx`; tests copy `server/actions/authorizedUsers.test.ts`.
- "Change password" dialog in `components/UserMenu.tsx` (`supabase.auth.updateUser`).
- New shared zod schemas in `packages/shared/src/schemas/` (`createOwnerInput`, `createStaffInput`, `changePasswordInput`). Audit labels in `lib/audit.ts` (`tenant_created`, `staff_added`, …).
- Rule change in architecture.md: `admin.ts` may be imported only by `server/audit.ts` and the admin/team server actions.

### 8.4 Worker: one process, one session per tenant
- Keep `runLeaderLoop` + global lock unchanged. The leader session becomes a **tenant supervisor** (`apps/worker/src/tenants/supervisor.ts`): on start and every 30 s (plus Realtime on `tenants`) it loads active tenants, starts a session for new ones, stops sessions for suspended/removed ones. One tenant's failure is logged and retried with backoff without touching others.
- **`createTenantSession(tenantId)`** (`apps/worker/src/tenants/session.ts`): the current per-socket wiring moved out of `index.ts` (L92–97, L106, L114–161, L163–300): auth state, connection manager, send queue (pacing per socket), pairing watcher, ingest/group directory, assistant + rate limiter, reminders, scheduler, alerter (recipient = `tenant_owner_email`).
- **Repos take `tenantId`** and always filter / stamp it: `authStateRepo` (incl. `deleteAll` → only that tenant), `connectionRepo`, `pairingRepo` (Realtime channel per tenant with filter; `nextRequested`/`expireStale` scoped), `aiSettingsRepo` (+ `get_openrouter_key(p_tenant_id)`), `alertsRepo`, `groupsRepo` (`listAll`, `markForRelink`), `authorizedUsersRepo`, `scheduledPostsRepo` (`markLeftoverSendingUncertain`, `skipLate`, `claim`), `reminderRequestsRepo` (`expireOverdue`), `messagesRepo`, `auditRepo`, `usageRepo`.
- **Process-wide jobs stay single**, made tenant-aware: heartbeat (one update over all running tenants' `wa_connection` rows), embedding job (looks up each row's tenant key; per-tenant "waiting for key" flag), attachment cleanup.
- `OWNER_ALERT_EMAILS` env becomes the **platform** alert list (worker crash/lock problems); tenant connection alerts go to the tenant owner.
- One `SESSION_ENCRYPTION_KEY` still encrypts all tenants' session rows (each row separately).
- Tests: supervisor (start/stop/failure isolation) and session wiring with in-memory fakes, following `apps/worker/src/ingest/testStores.ts`; update existing tests for the new repo signatures.

### 8.5 Tests and docs
- New SQL test `supabase/tests/multi_tenant_isolation.sql`: tenant A cannot read/write tenant B in any table or storage folder; two tenants can share a group JID / phone; staff cannot write `dashboard_users`; non-admin cannot see other tenants.
- Docs: project-overview (§7 scope change, onboarding flow), data-models (all tables, functions, RLS), api-interfaces (new actions, changed RPCs), architecture (§5 lock + supervisor, admin client rule, alert env), ui-context (Admin, Team, change password), progress (Phase 8, ADRs superseding ADR-028 and the single-number ADR), README + `supabase/seed.sql` (fresh install = first tenant + platform admin), RUNBOOK.

## Files I will create or change (main ones)
- Create: `supabase/migrations/0016_multi_tenant.sql`, `supabase/tests/multi_tenant_isolation.sql`, `apps/worker/src/tenants/{supervisor,session}.ts` (+ tests), `apps/dashboard/app/(app)/admin/*`, `apps/dashboard/app/(app)/team/*`, `apps/dashboard/server/actions/{admin,team,account}.ts` (+ tests), shared schemas, `Workflow/Phases/11-Multi-Tenant.md`.
- Change: `apps/worker/src/index.ts`, every `apps/worker/src/db/*Repo.ts`, `apps/worker/src/env.ts`, dashboard pages/actions listed in 8.2, `components/{navItems,Sidebar,UserMenu}.tsx`, `lib/supabase/admin.ts` (comment/rule), `packages/shared/src/database.types.ts`, `supabase/seed.sql`, `supabase/tests/phase4_isolation.sql`, README, RUNBOOK, all `/Workflow` docs above.

## Schema / interface changes
Large: see 8.1. Documented in data-models.md and api-interfaces.md in the same task.

## Alternatives considered
- **Separate copy per owner** (current design): zero rebuild, full isolation, but each owner needs their own Supabase project + worker set up by hand. Owner chose one shared app.
- **Per-tenant lock / one worker per tenant:** spreads load and limits blast radius, but needs a process manager and many lock rows. Not needed at this size; can be added later because sessions are already per tenant.
- **Tenant via group join only (no `tenant_id` on child tables):** fewer columns, but slower and more error-prone RLS. Rejected.

## Risks / open questions
- **WhatsApp ban risk:** many numbers linked from one EC2 IP may look like automation to WhatsApp. Fine for a handful of tenants; many tenants may need more servers/IPs later.
- **Server size:** each WhatsApp connection uses memory (~50–150 MB). The current EC2 t4g.micro has 1 GB RAM (+2 GB swap), so it holds only a few tenants; a larger instance is needed as tenants grow. We'll measure in the live test.
- **One worker for all tenants:** a crash takes every tenant offline briefly (auto-restart as today).
- **Isolation depends on RLS + every worker repo filtering by tenant.** The repo layer has no tests today; the SQL isolation test and repo signature changes (tenantId required) are the safeguard.
- Biggest change since Phase 0; touches almost every table, action and worker module. Migration is applied only after a backup.

## How I will verify it works
- `pnpm typecheck`, `pnpm lint`, `pnpm test`; SQL isolation test.
- Live (owner, after backup): apply 0016 → tenant #1 bot keeps answering without re-pairing, dashboard unchanged for you. Create tenant #2 from /admin with a second number → its owner logs in with the temp password, changes it, pairs → both bots answer only in their own groups with their own training/key. Owner #2 sees none of tenant #1's data. Staff added by owner #2 sees only tenant #2 and no Connection / Settings / Team. Stop the worker → each owner gets their own offline email. Suspend tenant #2 → its bot disconnects and its users can't log in.
