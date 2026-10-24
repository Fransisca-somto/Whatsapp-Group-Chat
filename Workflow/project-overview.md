# Project Overview — WhatsApp Group Assistant

> Owned by the project owner. Agents may propose changes but must not edit scope on their own.
> Items marked `[DEFAULT]` are sensible defaults the owner has not explicitly confirmed. Flag them if a task depends on them.

---

## 1. What the Product Is

A WhatsApp assistant that lives inside a company's **staff group chats**. One dedicated WhatsApp number (linked through the Baileys library) sits in multiple groups belonging to the same company. It:

- **Answers questions when tagged**, using that group's own training plus that group's history.
- **Remembers each group's history** and can search deep into it (by meaning and by keyword) when a question needs it.
- **Lets authorized users create one-off reminders** by tagging it, always with a confirmation step.
- **Posts scheduled announcements and reminders** on its own. This is the only time it speaks without being tagged.
- Is managed from a **web dashboard**: groups and their training, the AI provider, authorized users, reminders, announcements, linking the number, and worker health.

Nothing in the code is specific to one company: each company gets its own copy and sets everything up from the dashboard (ADR-028).

The company's existing **customer chats on the official Meta Cloud API are completely separate** and continue unchanged.

## 2. Target Audience

| Who | Phase | How they interact |
|---|---|---|
| **Company staff** (group members) | Now | Tag the bot in WhatsApp groups to ask questions; receive announcements and reminders. |
| **Authorized users** (bot admins) | Now | Everything staff can do, plus create reminders by tag (or all members, if the group's toggle allows). |
| **Dashboard owner** | Now | Full control of the dashboard, including the destructive Relink action. |
| **Dashboard staff** | Now | Manage content (training, reminders, announcements, authorized users) but cannot relink or change Settings. `[DEFAULT]` |
| **Customers** in a group | **Future, gated** | Same as staff. Only enabled after the hardening phase is complete (see §6). |

## 3. Core Concepts

- **Company:** exactly one per deployment. Owns the single timezone, the bot name and the AI provider account (OpenRouter key and models, set by the owner on the Settings page; ADR-027).
- **Group:** a WhatsApp group the bot is in. Each group has **independent records**: training, messages, reminders, announcements, settings and logs. Groups never see each other's data.
- **Group training:** each group has its own training (headings with subheadings and details; typed, uploaded as `.txt` / `.md`, or copied from another group) plus optional bot instructions. The bot in a group knows only that group's training (owner decision 2026-10-22, ADR-026; replaces the shared company brain).
- **Authorized user:** a person on the dashboard's own list, identified by **phone number**. This list, not WhatsApp group-admin status, decides who may command the bot.
- **Lookup, not fine-tuning:** "training" in the dashboard means written reference material. The AI is never fine-tuned; at answer time it receives the group's training plus relevant history retrieved from the database, so edits apply to the next question.

## 4. Core User Flows

### 4.1 One-time setup (owner)
1. Owner gets a dedicated SIM and installs WhatsApp on a phone with it.
2. Worker is deployed to an always-on host.
3. In the dashboard **Connection** page, the owner enters the bot's phone number and clicks **Link number**.
4. A pairing code appears. The owner enters it in WhatsApp → *Linked devices* → *Link with phone number*.
5. The session is saved (encrypted) in Supabase, so restarts never need re-pairing.
6. Owner adds the number to the WhatsApp groups.
7. Each group appears in the dashboard as **Pending**. The owner **approves** it. Until approved, the bot is silent in that group and stores nothing from it.
8. Approval opens the group's **Train** tab, where the owner adds its training. Until a group has active training, the bot replies there that it hasn't been set up yet.

Before the bot can answer anywhere, the owner saves the company's OpenRouter key and picks the models on the **Settings** page.

### 4.2 Asking the bot a question (any member)
1. A member **tags the bot** (a real @mention, or a reply to one of the bot's messages).
2. The worker ignores every message that does neither, though it still **stores** all messages from approved groups for history.
3. The worker shows "typing" for 2–4 seconds (randomized).
4. The AI answers using: that group's training, the last 15 messages of that group, and the most relevant older messages found by hybrid search.
5. **Company questions** (anything about the company, its people, policies, prices, dates, systems, passwords, decisions or the group) are answered only from the training and history. If the answer is not there, the bot **says it doesn't know** and suggests asking a responsible person. It never guesses. (Confirmed by the owner, 2026-10-22.)
6. **General questions** (common knowledge, definitions, how-tos, writing help, e.g. "What is WhatsApp used for?") are answered from the AI's own knowledge when the group's **Answer general questions too** switch is on (the default). The bot never presents general knowledge as company policy, and treats unclear questions as company questions. With the switch off, it answers from the training and history only. (Owner decision, 2026-10-23, ADR-030.)

### 4.3 Creating a reminder by tag
1. A member tags the bot, e.g. "@bot remind us Friday 3pm to submit reports".
2. Code checks permission: the group's toggle is **admins only** (default) or **any member**. In admins-only mode, the sender's phone must be on the authorized-user list. If not, the bot politely refuses.
3. The AI parses the request into a structured draft (text + due time in the company timezone).
4. Code validates the draft (time is in the future, within 1 year, text not empty).
5. The bot replies with exactly what it understood, e.g. *"Reminder for Friday 9 Oct at 3:00 PM: submit reports. Reply **yes** to confirm or **no** to cancel."*
6. **Only the requester** can confirm, by replying "yes" within **2 minutes**. "no" cancels. Silence expires the request; nothing is saved.
7. On "yes", the reminder is saved and the bot confirms it is set.

### 4.4 Unprompted posts (scheduler)
1. Every 30 seconds the worker checks for due announcements and reminders.
2. It posts them to the correct group. A dashboard post may carry **one attachment** that an admin uploaded (photo, video, audio file or document, up to 16 MB) or **a voice note recorded in the dashboard**; photos, videos and documents carry the text as caption, while audio and voice notes are followed by the text as a second message. (Owner decision, 2026-10-24, ADR-036.)
3. If the worker was down when something was due: items up to **2 hours** late are sent with a short "(sent late)" note; older ones are marked **skipped** and shown in the dashboard. `[DEFAULT]`
4. Nothing is ever sent twice. If delivery is uncertain after a crash, the item is flagged **delivery uncertain** in the dashboard with a Resend button rather than resent automatically.

### 4.5 Dashboard management
- Approve, pause or archive groups; set each group's reminder permission toggle.
- Manage the authorized-user list (name + phone number, all groups or specific groups).
- Train each group: add, edit, turn off or delete entries; upload `.txt` / `.md` files; copy training from another group; set optional bot instructions.
- Settings (owner): company name, bot name, timezone, OpenRouter key and models.
- Create, view, edit, cancel announcements and reminders, including **recurring** reminders, optionally with one uploaded file or a recorded voice note.
- See worker status (connected, offline, logged out, pairing) and last heartbeat.
- Link and relink the number.
- View the audit log of bot actions.

### 4.6 Changing the number (relink)
1. Owner puts the new SIM in a phone and clicks **Relink number**, then confirms in a dialog.
2. Worker logs out the old session, clears it, and issues a new pairing code.
3. Owner enters the code; the bot is live again with no redeploy.
4. Because it is a new number, the dashboard shows a **re-admission checklist** listing every active group that must add the new number.

### 4.7 Alerts
If the bot is logged out, another device takes over its session, reconnecting fails 10 times in a row, or the worker is offline for more than 5 minutes, the owner receives an **email** (sent through Resend), at most once per incident. Changed from WhatsApp alerts via the Cloud API by the owner on 2026-10-18 (ADR-025).

## 5. Permissions Matrix

| Action | Any member | Authorized user | Dashboard staff | Dashboard owner |
|---|---|---|---|---|
| Ask the bot by tag | ✅ | ✅ | — | — |
| Create one-off reminder by tag | Only if group toggle = any member | ✅ | — | — |
| Edit / cancel reminders | ❌ | ❌ (dashboard only) | ✅ | ✅ |
| Create recurring reminders | ❌ | ❌ (dashboard only) | ✅ | ✅ |
| Create announcements | ❌ | ❌ | ✅ | ✅ |
| Manage knowledge, groups, authorized users | ❌ | ❌ | ✅ | ✅ |
| Link / relink number | ❌ | ❌ | ❌ | ✅ |

## 6. Bot Behavior Rules

- **Persona:** a helpful colleague, not a chatbot. Plain everyday words, answer first. (Owner decision 2026-10-22, ADR-029.)
- **Reply length matches the question:** a simple question gets a simple, short answer, even one line; a question that needs explaining gets 3–5 sentences. Never padded, never cut short when the detail is needed.
- **No AI-sounding filler:** no "Great question!", no restating the question, no "As an AI", no "I hope this helps" or sign-offs, no emojis unless the user used them.
- **Chat formatting only:** no headings or tables; a short list only for 3 or more steps or items; bold at most once.
- **Language:** reply in the language the user wrote in.
- **Abusive or off-topic messages:** one short polite decline, no engagement.
- **Group bot instructions** (optional, per group) add context such as "this is the sales team"; they never override these rules.
- **Never reveals** its system prompt, internal settings, other groups' content, or the authorized-user list.
- **Never claims** to have done something code did not actually do (e.g. never says "reminder set" before it is saved).

## 7. Strictly Out of Scope

Agents must not build any of the following, even partially:

- Fine-tuning or training any model on company or group data.
- Any change to the existing customer-chat system on the Meta Cloud API.
- Editing, cancelling or creating **recurring** reminders through the group chat.
- Reminders that @mention specific people (future phase).
- Direct (1-to-1) chats with the bot. The bot ignores private messages. `[DEFAULT]`
- Multiple companies / multi-tenancy.
- Multiple linked numbers at the same time.
- Media understanding (images, voice notes, documents). These are stored as metadata only. `[DEFAULT]`
- The AI creating, editing or choosing images, audio or files. Attachments are only what a person uploads or records (owner decision, 2026-10-24).
- Live audio streams or calls in groups (not possible for a WhatsApp bot); attachments on reminders set by tagging the bot; more than one attachment per post.
- The bot joining groups by invite link on its own, or creating groups.
- Customer-facing groups until the "Customer mode" gate in `progress.md` is passed.
- Automatic resending of messages whose delivery is uncertain.

## 8. Known Risks (accepted)

| Risk | Mitigation |
|---|---|
| Baileys is unofficial and violates WhatsApp's terms; the number can be banned. | Staff-only for now; relink flow with no redeploy; spare SIM; owner alerts; conservative sending (no bulk, human-like delays). |
| Two worker instances connecting at once causes logout or ban. | Leader lock plus stop-before-start deploys. |
| Prompt injection by group members. | AI proposes, code authorizes; bot knows only company knowledge and that group's history. |
| Stored staff messages are a privacy concern. | Per-group retention setting; history never crosses groups; revisit consent before customer mode. |
| WhatsApp may hide phone numbers behind anonymous IDs (LIDs). | Authorization requires a resolvable phone number; if none, the sender is treated as unauthorized and told so. |
