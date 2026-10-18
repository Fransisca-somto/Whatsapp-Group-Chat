# Step 02 — Database Setup

> Covers `progress.md` tasks **0.3** (Supabase linked, pgvector, migrations for all tables) and **0.4** (RLS).
> Scope: the database only. No dashboard login, no worker code, no feature logic.
> Rule (ADR-016): the agent writes files; the owner runs every terminal command and reports the output.

## Decisions made for this step
- Hosted Supabase project only (no Docker).
- Several small migrations, one per concern.
- First owner account created by hand in Supabase Auth, then linked by `seed.sql`.
- Rename `public.current_role()` to `public.current_dashboard_role()` (`current_role` is a reserved SQL keyword). `data-models.md` §4 is updated in the same task.
- Guard triggers: `bot_actions` is append-only; on `group_messages` only `handled_status`, `embedding` and `embedding_status` may change.
- One Supabase project only. A throwaway rehearsal project was dropped: the real project is empty, so it is already a fresh database.
- Owner and staff can both read full group message history (consistent with ADR-003).

## Sequence

### A. Owner prerequisites (no terminal)
1. Create a Supabase project. Save the database password somewhere safe.
2. Copy the Project URL, anon key and service-role key into local `.env` files. These are never committed.

### B. Supabase CLI (owner runs)
- Add the CLI as a pinned root dev dependency, then `supabase init`, `supabase login`, `supabase link --project-ref <ref>`.

### C. Migrations (agent writes) in `supabase/migrations/`
| File | Contents |
|---|---|
| `0001_extensions.sql` | `vector`, `pgcrypto`; `set_updated_at()` trigger function |
| `0002_core_tables.sql` | `company_settings`, `dashboard_users`, `knowledge_entries`, `groups`, `authorized_users`, `authorized_user_groups` |
| `0003_messaging_tables.sql` | `group_messages`, `scheduled_posts`, `pending_reminder_requests`, `bot_actions`, `ai_usage_daily` |
| `0004_worker_tables.sql` | `wa_connection`, `wa_auth_state`, `worker_lock`, `pairing_requests`, `alerts`; the single `id = 1` rows |
| `0005_indexes.sql` | HNSW and GIN indexes, partial unique indexes, `(status, due_at)` index |
| `0006_functions.sql` | `search_group_history`, `search_knowledge`, `claim_due_posts`, `acquire_worker_lock`, `current_dashboard_role`; worker-only functions revoked from `anon` and `authenticated`; guard triggers |
| `0007_rls.sql` | RLS on every table, policies per `data-models.md` §4, Realtime publication for `wa_connection`, `pairing_requests`, `alerts` |

Plus `supabase/seed.sql`: the `company_settings` row and the owner's `dashboard_users` row. The owner edits the placeholders (auth user id, company name, timezone) before running it.

### D. Apply and verify (owner runs)
1. Link the real project and run `db push --dry-run`, then `db push`. The project is empty, so it doubles as the fresh-database test. If a push fails, fix the migration file and re-push.
2. Create the owner login in Supabase Auth, turn off public sign-ups, edit and run `seed.sql` in the SQL Editor.
3. Run the verification queries and check the results.

### E. Types
Generate TypeScript types from the linked project into `packages/shared/src/database.types.ts`. Zod schemas stay in task 0.6.

### F. Docs
Update `data-models.md`, `architecture.md` and `progress.md` (0.3 and 0.4 done, session log, ADRs).

## Out of scope for this step
Dashboard login (0.5), zod schemas (0.6), tooling (0.2), and the pg_cron offline alert with its Edge Function (task 1.7).

## Exit criteria
- Migrations apply cleanly on a fresh database and on the real project.
- All 16 tables exist and have RLS enabled.
- With the anon key, no table is readable. A staff user cannot read `wa_auth_state` or `worker_lock`.
- `acquire_worker_lock('a')` returns true, then false for a second instance id.
- Search functions return empty results without error and cannot be called by `authenticated`.
- `pnpm -r typecheck` still passes with the generated types included.
