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
| cancelled / skipped / archived | `--status-neutral` (gray) | Inactive |

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

**Sidebar navigation (in this order):** Overview · Groups · Reminders & Announcements · Knowledge · Authorized Users · Connection · Audit Log · Settings.

## 4. Pages

| Route | Purpose | Key elements |
|---|---|---|
| `/` Overview | At-a-glance health | Worker status card, groups count, next 5 scheduled posts, items needing attention (late, uncertain, skipped). |
| `/groups` | Group list | Table: name, status, reminder permission, last activity. Pending groups pinned on top with Approve button. |
| `/groups/[id]` | One group | Settings (permission toggle, AI on/off, retention days, daily cap), scheduled posts for this group, recent messages (read-only). |
| `/schedule` | Reminders & announcements | Tabs: Upcoming · Needs attention · History. Create button opens form (group, kind, text, date/time, recurrence). |
| `/knowledge` | Company knowledge | List + editor (title, content, active toggle). Shows "embedding pending" until processed. |
| `/authorized-users` | Bot admin list | Table: name, phone (E.164), scope (all groups / specific), active. |
| `/connection` | Pairing & relink | Current number, status, last heartbeat, Link / Relink button, pairing code display with countdown, re-admission checklist after relink. Owner only. |
| `/audit` | Bot action log | Filterable table: time, group, actor, action, result. |
| `/settings` | Company settings | Company name, timezone, owner alert phone. Owner only. |

## 5. Component Conventions

- Use **shadcn/ui primitives** from `components/ui/` for all basics (Button, Input, Dialog, Table, Tabs, Switch, Select, Badge, Toast). Do not build parallel versions.
- Installed primitives: badge, button, dialog, dropdown-menu, input, label, sheet, skeleton. Generated files must import `cn` from `@/lib/utils` (newer shadcn templates import a separate `cn` npm package; we do not add it) and may only use button sizes our `button.tsx` defines.
- Shared app components live in `components/` and must be listed here (✅ = built):

| Component | Purpose |
|---|---|
| `<WorkerStatus />` ✅ | Live connection indicator (Realtime). Dot + label + "last seen Xs ago" (label hidden below `lg`). In the `<AppShell>` top bar. Data from `lib/useWorkerConnection.ts`; offline rule in `lib/workerStatus.ts`. |
| `<StatusBadge status=... />` ✅ | The only way to render statuses. Maps status → color token and label. |
| `<ConfirmDialog />` ✅ | Required for every destructive action. Optional `confirmWord` (relink uses `RELINK`), extra fields as children, `canConfirm` for extra validation; cannot be closed while `pending`. |
| `<DateTimeInCompanyTz />` ✅ | Displays any timestamp in the company timezone. |
| `<DateTimePicker />` | Inputs interpreted in company timezone; shows timezone label. |
| `<PhoneInput />` | Normalizes to E.164; validates before submit. |
| `<PairingCodeCard />` ✅ | Large monospace code shown as `ABCD-1234`, expiry countdown, linking steps, Cancel (open request) and Retry (expired / failed / cancelled). |
| `<EmptyState />` ✅ | Icon, one-line explanation, primary action. |
| `<PageHeader />` ✅ | Page title, optional description, actions on the right. |
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
