# Step 03 — Tooling Setup

> Covers `progress.md` task **0.2**: strict TypeScript, ESLint, Prettier and Vitest in every package.
> Scope: quality tooling only. No feature code.
> Rule (ADR-016): the agent writes files; the owner runs every terminal command and reports the output.

## Decisions made for this step
- Three extra TypeScript flags on top of `strict`: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. Not `exactOptionalPropertyTypes` (clashes with generated Supabase types).
- Type-aware ESLint for the worker and shared package (`no-floating-promises`, `no-misused-promises`, `no-explicit-any`), plus a ban on default exports (architecture §12). The dashboard keeps Next.js's own config, with Prettier compatibility added.
- Prettier for formatting; `Workflow/`, `CLAUDE.md`, `supabase/` and generated files are ignored.
- Vitest in every package, tests next to the code as `*.test.ts`. Dashboard component tests wait for task 0.5.
- No git hooks and no CI for now. Revisit before Phase 7 (would need an ADR).

## Sequence

### A. Dependencies (owner runs)
- Root dev dependencies: `eslint@^9`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `globals`, `prettier`.
- `vitest` in the worker, shared and dashboard packages.
- Dashboard alignment: `@types/node@^24` and `typescript@~5.9`.

### B. Files (agent writes)
- `tsconfig.base.json`: the three extra flags. `apps/dashboard/tsconfig.json` now extends the base.
- `eslint.config.mjs` (root, worker and shared) and `apps/dashboard/eslint.config.mjs`.
- `.prettierrc.json`, `.prettierignore`.
- Scripts: `format` and `format:check` at the root; `lint` and `test` in worker and shared; `typecheck` and `test` in the dashboard; the dashboard's nested `packageManager` field removed.
- `packages/shared/src/index.test.ts`: one smoke test proving Vitest runs.

### C. Verify (owner runs)
`pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, `pnpm --filter dashboard build`. Then a one-time `pnpm format` to normalise existing files. A temporary canary file confirms lint catches an un-awaited promise and a default export, then it is deleted.

### D. Docs
`architecture.md` (tooling rows, conventions), `progress.md` (0.2 done, ADR-021, session log).

## Out of scope for this step
Git hooks and CI, component-test setup (jsdom, Testing Library), the dashboard shell (0.5), zod schemas (0.6).

## Exit criteria
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm format:check` all pass from the project root, covering all three packages.
- The shared smoke test passes; worker and dashboard report no tests without failing.
- The canary file makes `pnpm lint` fail on both the floating promise and the default export.
- The dashboard still builds.
