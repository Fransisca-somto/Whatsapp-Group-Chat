# Step 04 — Dashboard Shell and Shared Schemas

> Covers `progress.md` tasks **0.5** (dashboard shell: auth, layout, sidebar, design tokens, `<StatusBadge>`) and **0.6** (shared zod schemas and time helpers).
> Scope: login, navigation frame, tokens, a few shared components, and the shared package's schemas and time helpers. No feature screens.
> Rule (ADR-016): the agent writes files; the owner runs every terminal command and reports the output.
> Naming note: the original request said "0.4–0.5". Task 0.4 (RLS) was finished and verified in step 02, so this step covers 0.5 and 0.6, the two remaining Phase 0 tasks.

## Decisions made for this step
- **0.6 is built before 0.5.** Dashboard forms and `<DateTimeInCompanyTz>` import from `@soft-agent-support/shared`, so the shared package comes first. Both stay in this one step file.
- **Shared package (0.6):** add `zod`, `date-fns` and `date-fns-tz`. Time helpers always take the timezone as an argument and never use server-local time (`architecture.md` §9). Only schemas the next phases need now are written; others arrive with their feature.
- **Login (0.5):** Supabase Auth with email and password `[DEFAULT]`. Public sign-ups stay disabled. The owner can switch to magic links later.
- **Role gate:** a signed-in user with no `dashboard_users` row is signed out with a clear message (matches ADR-019). Owner-only sidebar items (Connection, Settings) are hidden for staff; RLS and server actions remain the real enforcement.
- **Dashboard Supabase packages:** `@supabase/supabase-js` and `@supabase/ssr`, with browser and server clients in `apps/dashboard/lib/supabase/`.
- **Already in place (from step 01):** Next.js 16.4.0 and Tailwind CSS 4 are installed and the dashboard builds. Nothing to set up for either.
- **Request interception file:** Next.js 16 uses `proxy.ts` (replacing `middleware.ts`). Per `apps/dashboard/AGENTS.md`, the agent reads `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` and the authentication guide before writing it.
- **Styling:** shadcn/ui primitives, tokens from `ui-context.md` §2 as CSS variables (light and dark), Inter and JetBrains Mono through `next/font`. Tailwind 4 has no `tailwind.config.ts`; tokens are mapped in `globals.css` with `@theme inline`, and the `tailwind.config.ts` mention in `ui-context.md` §2 is corrected when this step runs. The visual system is still Open Default D11; the owner can restyle `ui-context.md` before this step runs.
- **Worker status:** the top bar gets a placeholder slot only. The live `<WorkerStatus>` is task 1.6.
- **Component tests:** jsdom and Testing Library are added to the dashboard now (deferred from step 03).

## Sequence

### A. Dependencies (owner runs)
- `packages/shared`: `zod`, `date-fns`, `date-fns-tz`.
- `apps/dashboard`: `@supabase/supabase-js`, `@supabase/ssr`, `lucide-react`, `sonner`, `react-hook-form`, `@hookform/resolvers`, and dev dependencies `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@vitejs/plugin-react`.
- `pnpm dlx shadcn@latest init`, then add: button, input, label, sheet, dropdown-menu, badge, skeleton.
- Dashboard `transpilePackages: ["@soft-agent-support/shared"]` is needed now that it imports real code (ADR-017).

### B. Shared package files, task 0.6 (agent writes)
- `packages/shared/src/time.ts`
  - `formatInCompanyTz(date, tz)`: for example "Fri 9 Oct, 3:00 PM WAT".
  - `zonedLocalToUtc(localDateTime, tz)` and `utcToZoned(date, tz)`.
  - `nextWeekdayOccurrence(weekday, time, tz, now)`: a weekday said after that time today means next week (`architecture.md` §9).
- `packages/shared/src/schemas/`
  - `phone.ts`: E.164 phone with a display formatter (+234 801 234 5678).
  - `enums.ts`: zod enums mirroring the `check (... in (...))` constraints in the migrations (the database has no Postgres enums, so `database.types.ts` types these columns as plain `string`).
  - `groupSettings.ts`, `authorizedUser.ts`: field schemas used by dashboard forms and server actions.
  - `intent.ts`: classification output (`question | create_reminder | dashboard_only_action | smalltalk | refuse`) with the "invalid output becomes `question`" fallback (`architecture.md` §4 step 7).
  - `index.ts` re-exports; `src/index.ts` exports the new modules.
- Tests beside each file (`*.test.ts`): time helpers checked in `Africa/Lagos` (no DST) and in one DST zone, to prove they are zone-correct; schema accept/reject cases.

### C. Dashboard files, task 0.5 (agent writes)
- **Auth**
  - `lib/supabase/client.ts`, `lib/supabase/server.ts`.
  - Request interception file (`proxy.ts` or `middleware.ts`): refreshes the session and redirects signed-out users to `/login`.
  - `app/login/page.tsx` with a react-hook-form and zod form; `server/auth.ts` with login and logout server actions; `server/currentUser.ts` returning the user and their `dashboard_users` role (null role means sign out).
- **Tokens and fonts:** `app/globals.css` with all colors from `ui-context.md` §2.1 and §2.2 (including `--status-*`); `app/layout.tsx` with fonts and a toaster.
- **Layout:** `app/(app)/layout.tsx` with top bar (logo, page title, `WorkerStatus` placeholder slot, user menu with logout) and `components/Sidebar.tsx` (the eight items in `ui-context.md` §3 order, drawer on mobile, active-link state, owner-only items hidden for staff).
- **Placeholder pages** for `/`, `/groups`, `/schedule`, `/knowledge`, `/authorized-users`, `/connection`, `/audit`, `/settings`, each with `<PageHeader>` and `<EmptyState>` so navigation works end to end.
- **Components:** `components/StatusBadge.tsx` (every status in `ui-context.md` §2.2, always with a text label), `PageHeader.tsx`, `EmptyState.tsx`, `DateTimeInCompanyTz.tsx` (uses the 0.6 helper).
- **Tests:** `vitest.config.ts` with jsdom; `StatusBadge.test.tsx` (every status renders its label); a unit test for the role-gate helper.

### D. Verify (owner runs)
- `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, `pnpm --filter dashboard build`.
- Manual, `pnpm --filter dashboard dev` with `apps/dashboard/.env.local` filled in:
  - Signed out, any route redirects to `/login`.
  - Owner logs in and sees all eight sidebar items; logout returns to `/login`.
  - A staff user logs in and does not see Connection or Settings.
  - A Supabase Auth user with no `dashboard_users` row is rejected with a message and signed out.
  - Layout works at 375 px width (drawer sidebar) and in dark mode.
- RLS re-test from the real dashboard session, as flagged in the step 02 log: owner and staff can read their tables; a non-dashboard user sees nothing.

### E. Docs
- `ui-context.md`: list `PageHeader`, `EmptyState`, `StatusBadge`, `DateTimeInCompanyTz` as built; correct the Tailwind config wording if needed.
- `architecture.md`: new dashboard libraries (Supabase SSR, react-hook-form, sonner, lucide-react, Testing Library), shared package libraries (`date-fns`, `date-fns-tz`), the request-interception file name, and the Vitest dashboard setup.
- `progress.md`: mark 0.5 and 0.6 done, add the session log entry, and an ADR for any new decision (for example login method).
- `api-interfaces.md`: only if a server action contract is worth documenting; login and logout are not expected to need it.

## Out of scope for this step
- Live `<WorkerStatus>` and the `/connection` page content (1.6).
- Real feature pages: groups, schedule, knowledge, authorized users, audit, settings.
- `<ConfirmDialog>`, `<DateTimePicker>`, `<PhoneInput>`, `<PairingCodeCard>`: built with the feature that first needs them.
- Password reset, user invitations, magic links.
- Git hooks and CI.

## Exit criteria
- The owner can log in to an empty dashboard and navigate all eight routes; logout works.
- Signed-out visitors and users without a `dashboard_users` row cannot see any page.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` pass from the root; the dashboard builds.
- Time helpers and schemas have passing unit tests, including a DST zone.
- Together with step 02, this meets the Phase 0 exit criteria: the owner can log in to an empty dashboard, and migrations apply cleanly on a fresh database.
