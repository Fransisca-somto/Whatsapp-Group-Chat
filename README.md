# Group Chatbot Agent

A WhatsApp group assistant for one company. A worker runs one linked WhatsApp number that sits in the company's staff groups. When someone tags it, it answers from that group's training and recent chat. A web dashboard manages groups, training, the AI provider, the WhatsApp link and worker health. Supabase holds all data.

Nothing in the code is specific to one company. Each company gets its own copy: its own Supabase project, its own worker, its own WhatsApp number (ADR-020, ADR-028).

- `apps/dashboard`: Next.js dashboard (Vercel)
- `apps/worker`: Node worker that holds the WhatsApp connection (Railway or Fly.io, one instance)
- `packages/shared`: types, schemas and helpers used by both
- `supabase/`: migrations and the seed template
- `Workflow/`: project docs. Agents start with `CLAUDE.md`.

## Set up for a new company

You need Node 24, pnpm (`corepack enable`), a Supabase account, a Resend account, an OpenRouter account, and a phone with a dedicated SIM for the bot's WhatsApp number.

### 1. Database

1. Create a new Supabase project.
2. Install and link: `pnpm install`, then `pnpm supabase link --project-ref <project ref>`.
3. Apply the schema: `pnpm supabase db push`.
4. In Supabase → Authentication → Users, create the owner's login and copy its User UID.
5. Fill the placeholders in `supabase/seed.sql` (company name, time zone, owner UID and name), then run it once in the Supabase SQL Editor.
6. In Supabase → Authentication → Sign In / Providers, turn off "Allow new users to sign up".

### 2. Environment

Copy `.env.example` to `apps/worker/.env` and `apps/dashboard/.env.local` and fill them in. Each file only needs its own section.

- `SESSION_ENCRYPTION_KEY`: generate with `openssl rand -base64 32`. Back it up outside the host. Changing it later forces a relink.
- `RESEND_API_KEY` and `OWNER_ALERT_EMAILS`: where "bot logged out" and "worker offline" emails go. Resend's test sender only reaches the Resend account's own address until a domain is verified.
- The OpenRouter key and models are **not** set here. The owner sets them on the dashboard (step 4).

### 3. Deploy

- **Dashboard:** deploy `apps/dashboard` to Vercel with the dashboard variables.
- **Worker:** deploy `apps/worker` to an always-on host with the worker variables. Run **exactly one instance**, with stop-before-start deploys (no overlapping rolling deploys). Never run a second copy against the same Supabase project.

### 4. From the dashboard (owner)

1. **Settings:** check the company name, bot name and time zone. Paste the OpenRouter API key (it is checked with OpenRouter, then stored encrypted) and pick a chat model and a fallback model.
2. **Connection:** enter the bot's number, click **Link number**, and enter the pairing code in WhatsApp → Linked devices → Link with phone number.
3. Add the bot's number to the WhatsApp groups. Each group appears under **Groups** as Pending.
4. **Approve** each group, then **train** it on its Train tab: type entries with headings and subheadings, upload a `.txt` / `.md` file, or copy training from another group.

The bot answers only in approved, trained groups, and only when tagged.

## Development

From the repository root:

```sh
pnpm install
pnpm dev            # dashboard and worker
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

After a migration, regenerate the database types:

```sh
pnpm supabase gen types typescript --linked > packages/shared/src/database.types.ts
```
