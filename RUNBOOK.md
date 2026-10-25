# Runbook

Plain steps for keeping the WhatsApp group assistant running: backups, and what to do when something goes wrong. For setting it up, see `README.md`.

**Where things are**

| What                            | Where                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Dashboard                       | Your Vercel address                                                                                            |
| Worker (the bot)                | Railway → your project → the worker service (or wherever you host it; see README "Run the worker on any host") |
| Data, files, the WhatsApp login | Supabase → your project                                                                                        |
| Alert emails                    | The addresses in `OWNER_ALERT_EMAILS`                                                                          |
| What the bot did, and why       | Dashboard → **Audit log**                                                                                      |

---

## Quick health check (1 minute)

1. Dashboard top bar shows **Connected** with a recent "last seen".
2. **Reminders & announcements**: nothing in **Needs attention** you haven't seen.
3. Tag the bot in a group with a simple question: it answers within a few seconds.

---

## Backups (weekly)

On the free Supabase plan there are **no downloadable backups**, so keep your own. If the bot becomes important, Supabase **Pro** (paid) keeps daily backups for you.

**What to keep safe**

1. **The database**: groups, training, messages, reminders, the audit log, and the WhatsApp login (stored encrypted).
2. **Attachment files** (photos, documents, voice notes in scheduled posts).
3. **`SESSION_ENCRYPTION_KEY`**: without it, a restored WhatsApp login can't be read and the bot has to be relinked. Keep a copy in a password manager, never in the repository.
4. The other worker and dashboard variables (also in a password manager).

**Back up the database**

You need the PostgreSQL tools (`pg_dump`, version 17 or newer; on Windows they come with the PostgreSQL installer, "Command Line Tools" only). If your network blocks Supabase's database port (as `pnpm supabase db push` showed), turn on WARP or use a hotspot.

1. Supabase → **Connect** → **Session pooler** → copy the connection string, and put your database password in it.
2. From any folder outside the repository:

```sh
pg_dump "<session pooler connection string>" --schema=public --no-owner --format=custom --file=backup-YYYY-MM-DD.dump
```

That one file holds every table the app uses (including the encrypted WhatsApp login). Keep the last few weeks somewhere safe, not in the repository.

(If you have Docker Desktop installed, `pnpm supabase db dump --data-only -f backup-YYYY-MM-DD.sql` does the same through the Supabase CLI.)

**Back up the attachment files**

Small numbers: Supabase → **Storage** → `post-attachments` → download. Many files: from the repository root, `pnpm supabase storage cp -r ss:///post-attachments ./attachments-backup --experimental --linked`. Files older than 30 days after their last post are deleted automatically anyway, so this is only needed for posts still waiting.

**Not in the backup (re-enter after a restore)**

- The OpenRouter key (stored in Supabase Vault): paste it again on **Settings**.
- The alert email settings in Vault: the worker writes them again when it starts.
- Dashboard logins (Supabase Authentication): add the users again (Authentication → Users), with their `dashboard_users` rows.

## Restore

**Into the same project** (data lost or damaged): ask before doing this; it overwrites tables.

```sh
pg_restore --dbname="<session pooler connection string>" --data-only --disable-triggers --no-owner backup-YYYY-MM-DD.dump
```

**Into a new Supabase project** (the old one is gone):

1. Create the project, then from the repository root: `pnpm supabase link`, `pnpm supabase db push` (all migrations), and run `supabase/seed.sql` in the SQL Editor.
2. `pg_restore` the backup into it as above.
3. Upload the attachment files back into the `post-attachments` bucket.
4. Update `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` on the worker host and the dashboard variables on Vercel, then redeploy both.
5. Re-enter the OpenRouter key and add the dashboard users (see above).
6. If the WhatsApp login was restored with the same `SESSION_ENCRYPTION_KEY`, the bot reconnects on its own. Otherwise: **Connection → Link number**.

---

## When something goes wrong

### "Bot logged out" email, or the number was banned

The bot stops answering and posting. Dashboard: **Logged out**.

- **Logged out but not banned** (someone removed the linked device on the phone): **Connection → Link number** with the same number, enter the code on the phone (WhatsApp → Linked devices → Link with phone number).
- **Banned** (WhatsApp shows a ban on the bot's phone):
  1. Put the spare SIM in a phone and set up WhatsApp on it.
  2. Dashboard → **Connection → Relink number** with the new number; enter the code on that phone.
  3. The Connection page lists the groups that need the new number. In WhatsApp, a group admin adds the new number to each one. Each group is active again within a minute, with its training and settings (within 30 days of the change; after that it needs approving again under **Groups**).
  4. Reminders and announcements keep their schedule; they post again once their group is back.

To lower the risk: the bot only talks in staff groups and only when tagged or scheduled; don't add it to large or public groups, and don't use the number for anything else.

### "Conflict" email

Another device took over the bot's WhatsApp session (for example, WhatsApp Web was opened with the bot's number). Close that other session, then **Connection → Relink number** with the same number.

### "Worker offline" email, or the dashboard shows Offline

The worker hasn't checked in for over 5 minutes. Nothing is answered or posted until it's back; posts due while it's down go out late with a note (up to 2 hours late) or are skipped and listed under **Needs attention**.

1. Railway → the worker service → **Deployments**: is the latest one running? Open **Logs**.
2. Look at the last lines:
   - `Invalid worker environment:` lists missing variables → add them under **Variables**; it redeploys.
   - `lock acquire failed` repeating, or `fetch failed` → Supabase is unreachable (see below).
   - A crash and restart loop → **Restart**; if it keeps crashing, redeploy the last working deployment (**Deployments → ⋯ → Redeploy**) and keep the logs for a developer.
   - The service is stopped or asks for a plan → the Railway trial has ended (see below).
3. When it's back, the logs show `lock acquired`, `leader session started`, `connected to WhatsApp`, and the dashboard shows Connected.

**Never run a second copy** to "fix" it (for example on your PC) while the host copy might still be running: only one connects, but the other gets in the way of alerts and diagnosis.

### Railway trial ending

Railway's trial is free for about a month. When it ends the worker stops (you'll get the offline email). Add a plan in Railway (Hobby, about $5/month) and press **Redeploy**, or move the worker to another host (README "Run the worker on any host"); no re-pairing is needed.

### The bot replies "Sorry, I can't answer right now"

The AI provider (OpenRouter) failed. **Audit log** → filter **AI failed** shows why:

- **no OpenRouter credit** → add credit on openrouter.ai.
- **OpenRouter key rejected** → **Settings → AI provider**: paste a new key.
- **AI took too long / AI service down** → usually passes on its own. If it lasts, **Settings** → pick a different chat model, and make sure a fallback model from another provider is set.

Scheduled posts and reminder confirmations don't use the AI and keep working.

### Supabase unreachable

Worker logs show `fetch failed`; the dashboard may not load.

- Check status.supabase.com.
- Free Supabase projects **pause after a week with no activity**; the running worker keeps it active, but if it was paused, open the project in Supabase and **Restore** it, then restart the worker.
- On a PC: the network may block Supabase; that's a reason to run the worker on a host.

### A post is in Needs attention

- **Delivery uncertain**: it may already be in the group. Check the group first; **Resend** only if it's missing.
- **Skipped**: the bot was offline for over 2 hours past its time. **Resend** if it's still useful, otherwise **Dismiss**.
- **Failed**: WhatsApp refused it (for example the bot was removed from the group). Fix the cause, then **Resend**.

### Someone says the bot ignored them

- Paused group, AI turned off for the group, or the group isn't trained → see the group's page.
- They tagged it more than 5 times in a minute, or the group reached its daily reply limit → the bot said so once, then stayed quiet.
- Setting a reminder in an "admins only" group → they must be on **Authorized users**, and WhatsApp must show their number (the bot tells them if it can't see it).
- **Audit log** shows every tag the bot received and what it did.

---

## Live check: five tags at once

After a big change (or a move to a new host), ask five people to tag the bot in the same group within a few seconds, each with a different question.

Expected: five replies, in the order the questions were sent, each quoting its own question. **Audit log** shows five "Answered" rows for that group. (The automated version of this check runs with the tests: `apps/worker/src/assistant/loadTest.test.ts`.)

---

## Moving the worker to another host

1. Set it up on the new host (README "Run the worker on any host"), with the **same** variables, especially `SESSION_ENCRYPTION_KEY`.
2. **Stop the old copy first**, then start the new one.
3. Check the logs show `connected to WhatsApp`. No re-pairing is needed: the WhatsApp login lives in Supabase.
