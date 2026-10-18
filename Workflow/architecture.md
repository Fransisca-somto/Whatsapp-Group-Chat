# Architecture

> Rules for where code goes, how layers talk, and how decisions are made. Update this file whenever a library, layer, folder or rule is added.

---

## 1. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Dashboard | **Next.js (App Router) + TypeScript**, deployed on **Vercel** | Occasional-use screens; serverless fits perfectly. |
| UI | **Tailwind CSS 4 + shadcn/ui** (Base UI primitives), lucide-react icons, **sonner** toasts, Inter and JetBrains Mono via `next/font` | See `ui-context.md`. Tailwind 4 has no `tailwind.config.ts`; tokens are mapped in `app/globals.css` with `@theme inline`. |
| Dashboard forms | **react-hook-form** + `@hookform/resolvers` (zod) | Schemas come from `packages/shared`. |
| Worker | **Node.js LTS + TypeScript**, deployed on **Railway or Fly.io** (single instance) | Baileys needs an always-on process holding a live socket. Serverless is not allowed for the worker. |
| WhatsApp (groups) | **Baileys** (`baileys`, formerly `@whiskeysockets/baileys`), pinned exactly at `7.0.0-rc14` | Unofficial WhatsApp Web client. |
| WhatsApp (alerts only) | Existing **Meta Cloud API** integration | Used only to alert the owner. |
| Database | **Supabase Postgres** with **pgvector** and full-text search | Relational data, hybrid search and session storage in one place. |
| Auth (dashboard) | **Supabase Auth** (email + password, sign-ups disabled) via `@supabase/ssr` | Browser and server clients in `apps/dashboard/lib/supabase/`. `apps/dashboard/proxy.ts` (Next.js 16's replacement for `middleware.ts`) refreshes the session and redirects signed-out visitors to `/login`; it is an optimistic check only. `server/currentUser.ts` re-checks the `dashboard_users` role; a user with no row is sent to `/auth/signout?reason=no_access`. |
| Realtime | **Supabase Realtime** | Dashboard sees worker status and pairing codes live; worker receives requests. |
| AI (chat) | **OpenRouter**, default model Claude Haiku, fallback model configurable | Cheap, swappable models. |
| AI (embeddings) | Configurable via env; default `text-embedding-3-small` (1536 dims) `[DEFAULT]` | Needed for semantic search. Changing the model requires re-embedding. |
| Validation | **zod** | Shared schemas for every boundary (`packages/shared/src/schemas/`). |
| Time | **date-fns** + **date-fns-tz** (shared package) | Helpers in `packages/shared/src/time.ts`; the timezone is always an argument. |
| Logging | **pino** (worker), structured JSON | Searchable logs on the host. Factory in `apps/worker/src/logger.ts` redacts secret-looking fields. `pnpm dev` pipes output through **pino-pretty** (dev dependency) for local reading; production output stays JSON. |
| Tests | **Vitest** in every package; tests live next to the code as `*.test.ts` | Unit tests for parsing, permissions, scheduling. The dashboard runs Vitest with jsdom, `@vitejs/plugin-react` and Testing Library (`apps/dashboard/vitest.config.ts`, `vitest.setup.ts`). |
| Lint / format | **ESLint 9** (type-aware `typescript-eslint` for worker and shared; Next's config for the dashboard) + **Prettier** | Root `eslint.config.mjs` serves worker and shared. Catches un-awaited promises, `any` and default exports. `pnpm format` / `pnpm format:check` at the root. |
| Package manager | **pnpm** workspaces (pinned `pnpm@12.10.1`, Node 24) | Monorepo. Build scripts are allow-listed in the root `pnpm-workspace.yaml` (`allowBuilds`). |
| Database tooling | **Supabase CLI** (root dev dependency `supabase`) | Migrations live in `supabase/migrations/`, numbered `0001_…` by concern, applied with `pnpm supabase db push`. `supabase/seed.sql` is not run by `db push`; the owner runs it once by hand in the SQL Editor. Extensions are installed in the `extensions` schema. |
| Worker dev runner | **tsx** (dev dependency, worker only) | Runs TypeScript directly with no build step. |
| Package scope | `@soft-agent-support/*` (`@soft-agent-support/shared` for `packages/shared`) | Owner-chosen name (npm scopes must be lowercase). |

## 2. Repository Layout

```
/
├── CLAUDE.md
├── Workflow/                   # The six context files
├── apps/
│   ├── dashboard/              # Next.js app (Vercel)
│   │   ├── app/                # Routes (App Router)
│   │   ├── components/         # Dashboard-only components
│   │   ├── components/ui/      # shadcn/ui primitives (generated, do not hand-edit style)
│   │   ├── lib/                # supabase clients, server actions helpers
│   │   └── server/             # Server-only logic (actions, data access)
│   └── worker/                 # Node worker (Railway/Fly)
│       └── src/
│           ├── index.ts        # Boot: env check, lock, start modules
│           ├── env.ts          # zod env schema (parseEnv)
│           ├── logger.ts       # pino factory with redaction
│           ├── lock/           # Leader lock (leaderLock.ts) + leader-only session loop (leaderLoop.ts)
│           ├── whatsapp/       # Baileys socket, auth-state adapter, send queue
│           ├── ingest/         # Message intake, storage, dedupe, tag detection
│           ├── assistant/      # Intent, answer generation, retrieval
│           ├── reminders/      # Tag-to-create flow, confirmation state machine
│           ├── scheduler/      # 30s poller, claiming, sending, recurrence
│           ├── pairing/        # Pair / relink request handling
│           ├── health/         # Heartbeat, alerts
│           ├── ai/             # OpenRouter + embeddings clients
│           └── db/             # Supabase service-role client + repositories
├── packages/
│   └── shared/                 # Types, zod schemas, constants, time utils (used by both apps)
│                               # src/database.types.ts is GENERATED (supabase gen types); never hand-edit,
│                               # regenerate after every migration.
└── supabase/
    ├── migrations/             # All schema changes
    └── seed.sql
```

## 3. Layer Boundaries

```
 Dashboard (Vercel) ──► Supabase ◄── Worker (Railway/Fly) ──► WhatsApp (Baileys)
        │                  ▲                │
        │                  │                ├──► OpenRouter (chat + embeddings)
        └── no direct ─────┘                └──► Meta Cloud API (owner alerts only)
            connection to worker
```

1. **The dashboard never talks to the worker directly.** All coordination goes through Supabase tables and Realtime (`api-interfaces.md` §2). The worker exposes no public HTTP endpoints except an optional private `/healthz` for the host.
2. **The dashboard reads through RLS** using the logged-in user's session, and writes through **server actions** that validate with zod and re-check the user's role.
3. **The worker uses the Supabase service-role key** and is the only component that writes messages, session state, heartbeats and sent-status.
4. **Inside the worker, modules talk through functions, not globals.** Only `whatsapp/` touches the Baileys socket. Only `ai/` calls OpenRouter. Only `db/` calls Supabase.
5. **`packages/shared` has no runtime dependencies on either app.**

## 4. The "AI Proposes, Code Authorizes" Pipeline

Every tagged message passes through these steps in order. No step may be skipped or reordered.

1. **Dedupe** — insert message by WhatsApp message ID; if it already exists, stop.
2. **Group gate** — group must be `active`; otherwise stop silently.
3. **Tag gate** — must be an @mention of the bot or a reply to a bot message.
4. **Rate gate** — per-user (5 tags/minute) and per-group daily reply cap (default 200). Over the limit: one short notice, then silence. `[DEFAULT]`
5. **Pending-confirmation check** — if this sender has a pending reminder request in this group, route to the confirmation handler first.
6. **Intent classification** (LLM, structured JSON) → `question | create_reminder | dashboard_only_action | smalltalk | refuse`.
7. **Validation** of LLM output with zod. Invalid output is treated as `question`.
8. **Authorization** (code only) for any action intent.
9. **Execution** (code only): retrieval + answer, or create a pending reminder request.
10. **Audit** — write to `bot_actions`.

The LLM's output can never grant permissions, choose a group, or write data.

## 5. Single-Connection Guarantee (Leader Lock)

A WhatsApp linked device must have exactly one live connection.

- Table `worker_lock` has a single row. A worker instance generates a random `instance_id` on boot.
- To acquire: atomic update where `lease_expires_at < now()` or `holder = instance_id`, setting `lease_expires_at = now() + 30s`.
- Holder renews every **10 seconds**. If renewal fails twice in a row, the worker **closes the socket immediately** and returns to trying to acquire.
- The Baileys socket is opened **only after** the lock is held.
- On graceful shutdown (SIGTERM): close socket, then release the lock.
- A renewal that returns false (another holder has the lease) fences immediately, without waiting for a second failure. Standby instances retry acquire every 5 s.
- Release is a guarded update (`holder = null` only where `holder = instance_id`) from `db/lockRepo.ts`; no extra SQL function.
- **Deploy rule:** the host must be configured for a single instance with stop-before-start (no overlapping rolling deploys). The lock is the safety net, not the primary control.

## 6. Session Storage

- Baileys auth state is stored in `wa_auth_state` (key/value) via a custom adapter in `whatsapp/authState.ts`.
- Values are **encrypted at rest with AES-256-GCM** using `SESSION_ENCRYPTION_KEY`.
- In-memory cache is the read path; writes are **debounced (500 ms) and batched** into one upsert. `creds` are written immediately.
- On logout (`DisconnectReason.loggedOut`) or relink: delete all rows in `wa_auth_state`, set connection status `logged_out`.
- Implementation: `whatsapp/authState.ts` (adapter), `whatsapp/crypto.ts` (AES-256-GCM, the row key is bound as associated data so a value moved to another row fails to decrypt), `db/authStateRepo.ts` (reads paged by 1000, upserts chunked by 500, deletes by 100).
- Writes happen only while the instance holds the leader lock. On fence, pending writes are **discarded**, never flushed, so a fenced worker cannot overwrite the new holder's session.
- `SESSION_ENCRYPTION_KEY` must never change for a linked session: a new key makes the stored session unreadable and forces a relink. Keep a backup of it outside the host.
- Baileys is pinned exactly (`baileys@7.0.0-rc14`; the package was renamed from `@whiskeysockets/baileys` in v7). Its install scripts (an engine check) and protobufjs' postinstall are disabled in `allowBuilds`; neither is needed at runtime.

## 7. Reconnect Policy

| Disconnect reason | Action |
|---|---|
| Logged out / bad session | Clear session, status `logged_out`, alert owner, wait for relink. No auto-reconnect. |
| Connection replaced (another device took over) | Status `conflict`, alert owner, do not reconnect automatically. |
| Restart required / connection lost / timed out | Reconnect with exponential backoff: 2s, 4s, 8s … max 60s, with jitter. |
| Anything else | Log, back off, reconnect. After 10 failures in a row, alert owner. |

## 8. Environment Variables

**Worker**
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SESSION_ENCRYPTION_KEY        # 32-byte base64
OPENROUTER_API_KEY
OPENROUTER_CHAT_MODEL         # default: anthropic/claude-haiku (exact slug pinned in code)
OPENROUTER_FALLBACK_MODEL
EMBEDDINGS_API_KEY
EMBEDDINGS_MODEL              # default: text-embedding-3-small
META_CLOUD_API_TOKEN          # for owner alerts
META_PHONE_NUMBER_ID
OWNER_ALERT_PHONE             # E.164
LOG_LEVEL
```
**Dashboard**
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY     # server-only, used sparingly in server actions
```
The worker validates all variables with zod on boot (`apps/worker/src/env.ts`) and exits with a clear error listing every missing or invalid variable by name (never its value). Variables become **required in the task that first uses them** (ADR-024): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SESSION_ENCRYPTION_KEY` from task 1.1; the `META_*` and `OWNER_ALERT_PHONE` variables from task 1.7; OpenRouter and embeddings variables from Phase 3. Until then they are optional but still format-checked when set. Empty values count as unset.

Locally the worker reads `apps/worker/.env` through Node's built-in `--env-file-if-exists` flag in its `dev` and `start` scripts (no `dotenv`). On the host, variables come from the platform and no file is needed.

## 9. Time Rules

- All timestamps stored as `timestamptz` in UTC.
- The single company timezone (IANA name, e.g. `Africa/Lagos`) lives in `company_settings.timezone`.
- All parsing of human times ("Friday 3pm") and all display uses that timezone, via shared helpers in `packages/shared/src/time.ts` (built on `date-fns-tz`). Never use the server's local time.
- "Friday" said on a Friday after that time means **next** Friday. Ambiguous dates are always confirmed explicitly with the full date in the confirmation message.

## 10. Sending Rules (ban mitigation)

- All outgoing messages go through one **send queue** in `whatsapp/sendQueue.ts`: one message at a time, minimum 1.5 s between sends, plus randomized jitter.
- Show "composing" presence for 2–4 s before AI replies.
- Never send bulk identical messages across many groups in the same second; stagger scheduled posts by at least 3 s.

## 11. Decision-Making Rules for Agents

1. Prefer the **simplest** solution that satisfies the spec.
2. Prefer **Postgres features** (constraints, functions, RLS) over application code for data integrity.
3. **No new infrastructure** (queues, caches, extra services) without an approved ADR in `progress.md`.
4. **No new dependency** without stating it in the plan with a reason.
5. When two rules conflict, the order of precedence is: `CLAUDE.md` → `project-overview.md` → this file → the others. If still unclear, ask.
6. Record every non-trivial decision as an ADR in `progress.md`.

## 12. Coding Conventions

- TypeScript `strict: true`. No `any` without a comment explaining why.
- Named exports only. One responsibility per file.
- Errors: never swallow. Log with context, then handle or rethrow.
- Every external input (Baileys messages, LLM output, form data) is parsed with zod before use.
- Database access only through repository functions in `db/` (worker) or `server/` (dashboard).
- File naming: `camelCase.ts` for modules, `PascalCase.tsx` for React components.
- Compiler flags beyond `strict` (in `tsconfig.base.json`, inherited by all packages): `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. Array and object lookups may be `undefined`; handle it.
- Lint rules enforced as errors in worker and shared: `no-floating-promises`, `no-misused-promises`, `no-explicit-any` (use a justified disable comment if truly needed) and no default exports (tool config files and Next.js pages and layouts are the exceptions).
- Relative imports in the worker and in `packages/shared` use the `.ts` extension (`./time.ts`), enabled by `allowImportingTsExtensions` in `tsconfig.base.json`. Turbopack (dashboard) cannot map `.js` specifiers to `.ts` files, and `NodeNext` (worker) rejects extensionless ones, so `.ts` is the only style all three tools accept. This relies on every package being `noEmit`; if shared ever gets a build step, add `rewriteRelativeImportExtensions`.
- Definition of Done checks, run from the root: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`.
