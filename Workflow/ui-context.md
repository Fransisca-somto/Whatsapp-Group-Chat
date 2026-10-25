# UI Context — Dashboard

> Visual and component rules for `apps/dashboard`. Every screen must follow these. Add any new token or shared component here in the same task that introduces it.
> The whole visual system is `[DEFAULT]`: the owner may restyle it, but must do so here first.

---

## 1. Design Principles

1. **Calm and operational.** This is an admin tool. Clarity beats decoration.
2. **Status is always visible.** Worker connection status shows in the top bar on every page.
3. **Destructive actions are slow on purpose.** Relink, cancel, delete and archive always require a confirmation dialog.
4. **Times are always shown in the company timezone**, with the timezone abbreviation (e.g. "Fri 9 Oct, 3:00 PM WAT").
5. **Mobile-usable.** The owner may check status from a phone; every page must work at 375 px width.

## 2. Design Tokens

Defined as CSS variables in `app/globals.css` (dark values under `prefers-color-scheme: dark`) and mapped to Tailwind with `@theme inline` in the same file (Tailwind 4 has no `tailwind.config.ts`). **Never use raw hex values or arbitrary Tailwind colors in components.** Use the tokens.

### 2.1 Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#FAFAF9` | `#0C0C0E` | Page background |
| `--surface` | `#FFFFFF` | `#16161A` | Cards, tables, dialogs |
| `--border` | `#E7E5E4` | `#2A2A30` | Dividers, inputs |
| `--foreground` | `#1C1917` | `#F5F5F4` | Primary text |
| `--muted-foreground` | `#78716C` | `#A1A1AA` | Secondary text, hints |
| `--primary` | `#15803D` | `#22C55E` | Primary buttons, links, focus |
| `--primary-foreground` | `#FFFFFF` | `#052E16` | Text on primary |
| `--destructive` | `#B91C1C` | `#EF4444` | Destructive actions |

### 2.2 Status colors (semantic, used only via `<StatusBadge>`)

| Status | Token | Meaning |
|---|---|---|
| connected / active / sent | `--status-ok` (green) | Healthy, done |
| pairing / pending / scheduled | `--status-info` (blue) | Waiting, in progress |
| late / delivery uncertain / paused | `--status-warn` (amber) | Needs attention |
| offline / logged out / failed / removed | `--status-error` (red) | Broken |
| cancelled / skipped / archived / unknown | `--status-neutral` (gray) | Inactive, or the dashboard could not read the status |

### 2.3 Typography

- Font: **Inter** (fallback: `system-ui, sans-serif`). Monospace: **JetBrains Mono** (pairing codes, IDs, phone numbers).
- Scale: `text-xs` 12, `text-sm` 14 (default body in tables), `text-base` 16 (body), `text-lg` 18 (card titles), `text-2xl` 24 (page titles).
- Weights: 400 body, 500 labels and buttons, 600 titles. Never bold whole paragraphs.

### 2.4 Spacing, radius, elevation

- Spacing follows the Tailwind 4 px scale. Page padding `p-4` mobile, `p-8` desktop. Gap between cards `gap-6`.
- Radius: `--radius: 0.5rem` (inputs, buttons), cards `rounded-xl`.
- Elevation: cards use a border, not a shadow. Only dialogs and dropdowns get `shadow-lg`.

## 3. Layout

```
┌───────────────────────────────────────────────┐
│ Top bar: logo · page title · <WorkerStatus> · user menu │
├──────────┬────────────────────────────────────┤
│ Sidebar  │  Page content (max-w-6xl)           │
│ (drawer  │                                     │
│ on mobile)│                                    │
└──────────┴────────────────────────────────────┘
```

The window itself never scrolls: the app shell is exactly the screen's height, and the sidebar and the page area (`<main data-page-scroll>`) each scroll on their own. The top bar and sidebar therefore never move, and a page can fill the screen (the group chat measures itself against `data-page-scroll`).

**Sidebar navigation (in this order):** Overview · Groups · Reminders & Announcements · Training · Authorized Users · Connection · Audit Log · Settings. ("Training" was "Knowledge" until 2026-10-22; its route is still `/knowledge`.)

## 4. Pages

| Route | Purpose | Key elements |
|---|---|---|
| `/` Overview | At-a-glance health | "AI not configured" notice until a key and chat model are saved (built). **Upcoming posts** card (built): next 5 scheduled posts (kind, group, text, time, repeat) and a "N posts need attention" link to Needs attention. Worker status card and groups count: later. |
| `/groups` | Group list | Table: name, status, reminder permission, last activity. Pending groups pinned on top with Approve button. Active and paused groups with no active training show a **Not trained** badge linking to their Train tab. Removed groups waiting for the new number after a relink show **Waiting for the new number** (7.1). Approving a group opens its Train tab. |
| `/groups/[id]` | One group | Tabs **Settings · Train · Messages**, kept in `?tab=`. Settings: permission toggle, AI on/off, retention days, daily cap. Train: the group's training entries (add, edit, turn off, delete; upload `.txt` / `.md`; copy from another group) and optional bot instructions. Each entry shows an outline **Indexing…** badge until search has indexed it, and a destructive **Not searchable** badge after 3 failed tries (tooltip: edit and save to try again; P13; `indexingMarker` in `lib/training.ts`). Messages: a read-only **chat view** that fills the screen below the tabs, so only the messages scroll (header with the group name and "Read-only view of the group chat"; a disabled message box at the bottom, "Replies are sent by the bot in WhatsApp"; oldest at the top, opens scrolled to the newest; staff bubbles on the left, the bot's on the right in a tinted bubble under its Settings name; sender name once per run; day dividers; time of day in each bubble; bot mentions shown as "@<bot name>"; bot replies show a quote of the question; @ icon on tagged messages; "Load older" at the top keeps the reader's place). **Scheduled** tab (P20): this group's upcoming posts (same rows as `/schedule`, without the group name), "New post" with the group filled in (disabled unless the group is active or paused), and a link to the rest ("N need attention" or "History and more"); a destructive count badge on the tab when posts need attention. |
| `/schedule` | Reminders & announcements | Built. Tabs **Upcoming · Needs attention · History** (`?tab=`), group filter (`?group=`), **New post** button. Each row: `<StatusBadge>` (a post sent late shows "Late"), kind, group link, text (3 lines), due or sent time, repeat label ("Every weekday at 9:00 AM"). Upcoming: edit and cancel (confirmation; for a series, "This ends the series"). Needs attention (count badge on the tab): failed / delivery uncertain / skipped, with the reason in plain words, **Resend** (confirmation; for uncertain posts "Check the group first") and **Dismiss**. History: sent, cancelled and dismissed. 100 rows per list. The sidebar link shows the Needs attention count. |
| `/knowledge` | Training overview | One card per group (not archived): entries in use, entries turned off, last edit, **Not trained** badge; each links to the group's Train tab. Training is edited only on the group page (ADR-026). |
| `/authorized-users` | Bot admin list | Built. Header explains that in "admins only" groups only listed people can set reminders by tagging the bot. **Add person**; rows show name (and "Turned off"), number (`formatPhoneForDisplay`, monospace), "All groups" or the group names; an on/off switch, edit, and remove (confirmation: "Reminders they already set stay scheduled"). `AuthorizedUserDialog`: name, WhatsApp number (`<PhoneInput>`), All groups switch, otherwise group checkboxes (at least one). Empty state explains the list. |
| `/connection` | Pairing & relink | Current number, status, last heartbeat, Link / Relink button, pairing code display with countdown. **Re-admission checklist** (built, 7.1, `ReadmissionChecklist`): after a relink, an amber card "Add the new number to N groups" with when the number was changed, the instruction, and each waiting group (link) marked "Waiting for the new number"; groups leave the list as the new number is added, and the card disappears when none are left. Owner only. |
| `/audit` | Bot action log | Built. Filters for group and action (kept in `?group=` / `?action=`); table of time, group, who (dashboard user name, member phone, or System), action and a one-line result (e.g. "answered · 412 tokens", "answered · found 3 older messages · 412 tokens", "tried to change the rules", "1,250 messages older than 90 days" for the daily retention clean-up); 50 per page with "Load older"; cards on mobile. Labels and summaries in `lib/audit.ts`. |
| `/settings` | Company and AI provider | **Company:** company name, bot name, timezone (type-to-search list). **AI provider:** OpenRouter key (password field; after saving only "ends in …abcd" with Replace and Remove), chat model and optional fallback model (type-to-search list of OpenRouter models with prices). Owner only. |

## 5. Component Conventions

- Use **shadcn/ui primitives** from `components/ui/` for all basics (Button, Input, Dialog, Table, Tabs, Switch, Select, Badge, Toast). Do not build parallel versions.
- Installed primitives: badge, button, dialog, dropdown-menu, input, label, select, sheet, skeleton, switch, table, tabs, textarea. `select`, `switch` and `table` (2026-10-19), and `tabs` and `textarea` (2026-10-22), were hand-written in shadcn's Base UI style (2026-10-19) because the shadcn registry was unreachable; `<Select>` takes `items` (value → label) so the trigger shows the label. Generated files must import `cn` from `@/lib/utils` (newer shadcn templates import a separate `cn` npm package; we do not add it) and may only use button sizes our `button.tsx` defines.
- Shared app components live in `components/` and must be listed here (✅ = built):

| Component | Purpose |
|---|---|
| `<WorkerStatus />` ✅ | Live connection indicator (Realtime, plus a re-read every 30 s). Dot + label + "last seen Xs ago" (label hidden below `lg`). If the latest read failed, or the row is not visible (e.g. an expired login token), it shows **Unknown** · "Can't check right now", never a false Offline. Realtime events with an empty record are ignored and trigger a re-read. In the `<AppShell>` top bar. Data from `lib/useWorkerConnection.ts`; offline rule in `lib/workerStatus.ts`. |
| `<StatusBadge status=... />` ✅ | The only way to render statuses. Maps status → color token and label. |
| `<ConfirmDialog />` ✅ | Required for every destructive action. Optional `confirmWord` (relink uses `RELINK`), extra fields as children, `canConfirm` for extra validation; cannot be closed while `pending`. |
| `<DateTimeInCompanyTz />` ✅ | Displays any timestamp in the company timezone. |
| `<DateTimePicker />` ✅ | Native date-time input whose value is a wall-clock time in the company timezone (never the browser's), with "<Area/City> time" beside it. The server converts it to UTC. |
| `<PhoneInput />` ✅ | Phone in international format; spaces, dashes, dots and brackets allowed. Shows "Saved as +234 801 234 5678" once valid, otherwise the format hint. Validation with shared `phoneE164Schema` on submit. |
| `<PairingCodeCard />` ✅ | Large monospace code shown as `ABCD-1234`, expiry countdown, linking steps, Cancel (open request) and Retry (expired / failed / cancelled). |
| `<EmptyState />` ✅ | Icon, one-line explanation, primary action. |
| `<PageHeader />` ✅ | Page title, optional description, actions on the right. |
| Schedule ✅ | `components/schedule/`: `ScheduleView` (tabs, filter, New post), `ScheduleList` (rows and their actions per tab), `ScheduledPostDialog` (group, Reminder / Announcement, message with counter, `<DateTimePicker>`, repeat: Doesn't repeat · Every day · Every weekday · Weekly on chosen days (day toggles) · Monthly on day 1–28 or the last day; live "What the group will see" preview with the first post time and repeat label), `GroupScheduleTab`. Labels and reasons in `lib/schedule.ts`; data from `server/schedule.ts`. A reminder set by tagging the bot shows "Set in the group by +234 …" in its time line (P26). **Attachments (6.7):** the dialog has an Attachment section, `AttachmentPicker`: **Attach file** (file chooser limited to the allowed types; checked before upload; "Uploading…"; error message) or **Record voice note** (`VoiceRecorder`: microphone permission, live timer up to 5:00, Stop, listen back, Attach recording / Record again / Discard; a finished recording that wasn't attached is attached automatically when the post is saved, and **Schedule post** is disabled while still recording ("Finish the recording first (press Stop).") or uploading ("Wait for the upload to finish."); plain messages when the browser can't record or the microphone is blocked). Once attached: a preview (image, video or audio player for files picked in this form) with the name or "Voice note (0:42)", size and Remove. "Message" becomes optional, and "What the group will see" says how it arrives (with the text as caption, or the text as a second message for audio). Schedule rows show a paperclip or microphone with the file name or voice length, "(file removed)" after cleanup. `<SidebarNav>` takes `badges` (count by href) from the layout. |
| Group pages ✅ | `/groups` (table on desktop, cards on mobile; pending pinned first with `ApproveGroupButton`), `/groups/[id]` (`GroupStatusActions` with archive confirmation, `GroupTabs`, `GroupSettingsForm`, `GroupMessages` chat view, see `/groups/[id]` above). Labels in `lib/groups.ts`. |
| Training ✅ | `TrainTab` (entry list with preview, subheading count, on/off switch, edit, delete with confirmation; Copy from group; bot instructions box), `TrainingEntryDialog` (heading plus repeatable subheading + details fields, character counter, 8,000 limit), `ImportTrainingDialog` (pick `.txt` / `.md` ≤ 200 KB, review the split with tick boxes and warnings, then save). Shapes and previews in `lib/training.ts`. |
| Settings ✅ | `CompanySettingsForm`, `AiProviderForm` (key section never shows the saved key; models section disabled when OpenRouter's list can't be loaded). |
| `<AppShell />` ✅ | Top bar (logo, page title, worker-status slot, `<UserMenu />`) plus `<Sidebar />`; the sidebar becomes a drawer on mobile. Items come from `components/navItems.ts`; owner-only items are hidden for staff. |

- **Forms:** react-hook-form + zod schemas imported from `packages/shared`. Inline field errors under the input. Submit buttons show a spinner and are disabled while pending.
- **Tables:** sortable headers where useful; on mobile, collapse to stacked cards.
- **Feedback:** success and error toasts for every mutation. Error toasts include a human-readable reason, never a raw stack.
- **Loading:** skeletons for initial loads; no full-page spinners.
- **Empty states:** every list has one, with the next action (e.g. "No groups yet. Add the bot's number to a WhatsApp group, then approve it here.").

## 6. Copy & Tone

- Plain, short sentences. Sentence case for buttons and headings ("Link number", not "Link Number").
- Name things the same everywhere: **Group**, **Reminder**, **Announcement**, **Authorized user**, **Relink**, **Pairing code**.
- Phone numbers always displayed in E.164 with spaces for readability (+234 801 234 5678).

## 7. Accessibility

- All interactive elements keyboard reachable with visible focus ring (`--primary`).
- Color is never the only signal: every status badge includes a text label.
- Minimum contrast 4.5:1 for text.
- Dialogs trap focus and close on Escape (except relink while in progress).
