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
- **Worker:** see **Run the worker on any host** below. Run **exactly one copy** per Supabase project.

#### Run the worker on any host

The worker ships as a Docker image (`apps/worker/Dockerfile`), so any host that runs containers works: Railway, Fly.io, Render, or a small server. Whatever the host, it must give the worker:

1. **Always on.** Not "serverless" (Vercel can't run the worker): it holds a live WhatsApp connection.
2. **Exactly one copy.** Never scale to two. The leader lock stops a second copy from connecting, but it would sit idle and make alerts and logs confusing. **Stop any copy running on a PC** once the host is up.
3. **About 15 seconds to stop on redeploy** before it is force-stopped, so it can close WhatsApp, save the session and release the lock. The next copy then connects within seconds.
4. **Internet access and environment variables.** Set the worker variables from `.env.example`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_ENCRYPTION_KEY` (the **same** one as before, or the bot must be relinked), `RESEND_API_KEY`, `OWNER_ALERT_EMAILS`, and optionally `ALERT_FROM_EMAIL`, `DASHBOARD_URL`, `LOG_LEVEL`.

No web address, port, volume or health-check URL is needed: the worker only makes outgoing connections, and its health shows on the dashboard (heartbeat) and by email (offline alert). The WhatsApp session is stored in Supabase, so moving hosts **does not need re-pairing**.

Build it from the repository root (the shared package is included):

```sh
docker build -f apps/worker/Dockerfile -t group-assistant-worker .
```

##### Railway (first host)

1. On railway.com: **New Project → Deploy from GitHub repo** → pick this repository. Railway deploys again whenever `main` changes.
2. Open the service → **Settings**:
   - **Build:** builder *Dockerfile*, Dockerfile path `apps/worker/Dockerfile`, root directory `/` (the repository root).
   - **Deploy:** replicas **1**; restart policy *On failure*.
   - **Networking:** no public domain (leave it off).
   - **Region:** the one closest to your Supabase project (Supabase → Project Settings → General shows its region).
3. **Variables:** add the worker variables above, plus `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15` (requirement 3).
4. **Deploy.** In **Logs**, wait for `lock acquired`, `leader session started` and `connected to WhatsApp`; the dashboard shows the worker as Connected.
5. **Stop the worker on your PC** (Ctrl + C) and don't start it again while Railway runs it.

Railway's trial is free for about a month; after that a paid plan (Hobby, about $5/month) keeps the worker running. If it stops, the offline email arrives within about 5 minutes. See `RUNBOOK.md`.

##### Fly.io

`fly launch --no-deploy --dockerfile apps/worker/Dockerfile` from the repository root, remove any `[http_service]` section from `fly.toml`, set `kill_timeout = "15s"`, add the variables with `fly secrets set NAME=value …`, then `fly deploy` and `fly scale count 1`.

##### A server with Docker

Build the image as above, put the variables in a file (never commit it), and run one container that restarts on its own and gets 15 s to stop:

```sh
docker run -d --name group-assistant-worker --restart unless-stopped \
  --stop-timeout 15 --env-file worker.env group-assistant-worker
```

To update: `git pull`, build again, then `docker stop group-assistant-worker && docker rm group-assistant-worker` and run it again (stop the old one before starting the new one).

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
