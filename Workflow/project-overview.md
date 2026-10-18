# Project Overview — WhatsApp Group Assistant

> Owned by the project owner. Agents may propose changes but must not edit scope on their own.
> Items marked `[DEFAULT]` are sensible defaults the owner has not explicitly confirmed. Flag them if a task depends on them.

---

## 1. What the Product Is

A WhatsApp assistant that lives inside a company's **staff group chats**. One dedicated WhatsApp number (linked through the Baileys library) sits in multiple groups belonging to the same company. It:

- **Answers questions when tagged**, using shared company knowledge plus that group's history.
- **Remembers each group's history** and can search deep into it (by meaning and by keyword) when a question needs it.
- **Lets authorized users create one-off reminders** by tagging it, always with a confirmation step.
- **Posts scheduled announcements and reminders** on its own. This is the only time it speaks without being tagged.
- Is managed from a **web dashboard**: groups, authorized users, company knowledge, reminders, announcements, linking the number, and worker health.

The company's existing **customer chats on the official Meta Cloud API are completely separate** and continue unchanged.

## 2. Target Audience

| Who | Phase | How they interact |
|---|---|---|
| **Company staff** (group members) | Now | Tag the bot in WhatsApp groups to ask questions; receive announcements and reminders. |
| **Authorized users** (bot admins) | Now | Everything staff can do, plus create reminders by tag (or all members, if the group's toggle allows). |
| **Dashboard owner** | Now | Full control of the dashboard, including the destructive Relink action. |
| **Dashboard staff** | Now | Manage content (knowledge, reminders, announcements, authorized users) but cannot relink. `[DEFAULT]` |
| **Customers** in a group | **Future, gated** | Same as staff. Only enabled after the hardening phase is complete (see §6). |

## 3. Core Concepts

- **Company:** exactly one per deployment. Owns the shared knowledge base and the single timezone.
- **Group:** a WhatsApp group the bot is in. Each group has **independent records**: messages, reminders, announcements, settings and logs. Groups never see each other's data.
- **Shared brain:** every group reads from the same company knowledge base.
- **Authorized user:** a person on the dashboard's own list, identified by **phone number**. This list, not WhatsApp group-admin status, decides who may command the bot.
- **Lookup, not training:** the AI is never fine-tuned. At answer time it receives company knowledge plus relevant history retrieved from the database.

## 4. Core User Flows

### 4.1 One-time setup (owner)
1. Owner gets a dedicated SIM and installs WhatsApp on a phone with it.
2. Worker is deployed to an always-on host.
3. In the dashboard **Connection** page, the owner enters the bot's phone number and clicks **Link number**.
4. A pairing code appears. The owner enters it in WhatsApp → *Linked devices* → *Link with phone number*.
5. The session is saved (encrypted) in Supabase, so restarts never need re-pairing.
6. Owner adds the number to the WhatsApp groups.
7. Each group appears in the dashboard as **Pending**. The owner **approves** it. Until approved, the bot is silent in that group and stores nothing from it.

### 4.2 Asking the bot a question (any member)
1. A member **tags the bot** (a real @mention, or a reply to one of the bot's messages).
2. The worker ignores every message that does neither, though it still **stores** all messages from approved groups for history.
3. The worker shows "typing" for 2–4 seconds (randomized).
4. The AI answers using: company knowledge, the last 15 messages of that group, and the most relevant older messages found by hybrid search.
5. If the answer is not in the knowledge or history, the bot **says it doesn't know** and suggests asking a responsible person. It never guesses. `[DEFAULT]`

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
2. It posts them to the correct group.
3. If the worker was down when something was due: items up to **2 hours** late are sent with a short "(sent late)" note; older ones are marked **skipped** and shown in the dashboard. `[DEFAULT]`
4. Nothing is ever sent twice. If delivery is uncertain after a crash, the item is flagged **delivery uncertain** in the dashboard with a Resend button rather than resent automatically.

### 4.5 Dashboard management
- Approve, pause or archive groups; set each group's reminder permission toggle.
- Manage the authorized-user list (name + phone number, all groups or specific groups).
- Manage company knowledge entries.
- Create, view, edit, cancel announcements and reminders, including **recurring** reminders.
- See worker status (connected, offline, logged out, pairing) and last heartbeat.
- Link and relink the number.
- View the audit log of bot actions.

### 4.6 Changing the number (relink)
1. Owner puts the new SIM in a phone and clicks **Relink number**, then confirms in a dialog.
2. Worker logs out the old session, clears it, and issues a new pairing code.
3. Owner enters the code; the bot is live again with no redeploy.
4. Because it is a new number, the dashboard shows a **re-admission checklist** listing every active group that must add the new number.

### 4.7 Alerts
If the worker is logged out, or offline for more than 5 minutes, the owner receives a WhatsApp alert through the **existing official Cloud API integration**, at most once per incident. `[DEFAULT]`

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

- **Persona:** a polite, concise company assistant. Short replies suited to group chat. `[DEFAULT]`
- **Language:** reply in the language the user wrote in. `[DEFAULT]`
- **Abusive or off-topic messages:** one short polite decline, no engagement. `[DEFAULT]`
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
