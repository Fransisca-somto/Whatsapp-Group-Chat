# CLAUDE.md — Agent Operating Rules

> **Read this file first, every session, before doing anything else.**
> This is the front door to the project. It tells you the rules, where the context lives, and how to work. The six files in `/Workflow` hold the details. This file does not duplicate them; it routes you to them.

---

## 1. The Prime Directive: Plan Before You Build

**You must never write, modify or delete code until the project owner has approved your plan.**

For every task, no matter how small, follow this sequence:

1. **Read** `Workflow/progress.md` to learn the current phase, what is done and what is in progress.
2. **Read** whichever other `/Workflow` files the task touches (see the routing table in section 3).
3. **Present a plan** in this exact format, then stop and wait:

```
## Plan: <task name>

**Goal:** One sentence describing the outcome.
**Phase:** Which phase/milestone in progress.md this belongs to.
**Approach:** How I intend to do it, step by step.
**Files I will create or change:** List with one line each on why.
**Schema / interface changes:** None, or exactly what changes (and which doc I will update).
**Alternatives I considered:** At least one, with why I did not choose it.
**Risks / open questions:** Anything I am unsure about or need the owner to decide.
**How I will verify it works:** Tests, manual checks, or both.
```

4. **Wait for explicit approval** ("approved", "go ahead", "yes"). If the owner suggests a different method, discuss it and present a revised plan. Do not start coding on a partial or implied approval.
5. **Build** exactly what was approved. If you discover mid-task that the plan must change, **stop and re-plan** rather than improvising.
6. **Update the docs** (section 5) as part of finishing the task, then summarize what you did.

The only exceptions: answering questions, reading files, and running read-only commands to investigate. These never need approval.

---

## 2. What This Project Is (one paragraph)

A WhatsApp **group assistant** for a single company. A Node/TypeScript worker uses the Baileys library to run one linked WhatsApp number that sits in multiple staff groups. It answers questions when tagged, using each group's own training plus searchable per-group history, lets authorized users create one-off reminders by tagging it (with confirmation), and posts scheduled announcements and reminders. A Next.js dashboard on Vercel manages groups and their training, the AI provider (the company's own OpenRouter key and models), authorized users, reminders, announcements, pairing and worker health. Nothing is company-specific in code, so the project can be copied for another company. Supabase holds all data. The company's existing customer chats on the official Meta Cloud API are **separate and must not be touched**. Full details: `Workflow/project-overview.md`.

---

## 3. Context Routing Table

| If the task involves... | Read first |
|---|---|
| Anything at all | `Workflow/progress.md` (always) |
| Product scope, user flows, "should we build X?" | `Workflow/project-overview.md` |
| Folder structure, layers, libraries, where code goes | `Workflow/architecture.md` |
| Dashboard screens, components, styling | `Workflow/ui-context.md` |
| Tables, columns, migrations, queries, RLS | `Workflow/data-models.md` |
| Worker ↔ dashboard communication, AI calls, Baileys events, route handlers | `Workflow/api-interfaces.md` |

---

## 4. Non-Negotiable Rules

These apply everywhere. If a task seems to require breaking one, stop and raise it in your plan.

1. **Plan before you build** (section 1).
2. **Out of scope means out of scope.** If it is listed under "Out of Scope" in `project-overview.md`, do not build it, even partially, even "for later".
3. **The AI proposes, code authorizes.** The LLM may classify intent and parse text. It must never decide permissions, never write to the database directly, and its output must always be validated by deterministic code before any action.
4. **Exactly one WhatsApp connection.** Never write code that could let two worker instances connect at once. All connection logic goes through the leader lock (`architecture.md` §5).
5. **Never touch the customer-chat system** (Meta Cloud API webhooks, customer conversation tables). This project does not use the Cloud API at all; owner alerts go by email through Resend (ADR-025).
6. **Schema changes only via migrations** in `supabase/migrations/`. Never edit the database by hand. Every schema change must also update `Workflow/data-models.md` in the same task.
7. **No secrets in code.** Use environment variables listed in `architecture.md` §8.
8. **Types are shared, not duplicated.** Shared types and zod schemas live in `packages/shared`.
9. **Follow existing patterns.** Before adding a library, pattern or folder, check `architecture.md`. If it is not there, propose it in your plan.
10. **Do not "improve" unrelated code.** Stay inside the approved plan's file list.

---

## 5. Keeping the Docs Alive

The docs are the project's memory. A task is **not finished** until the docs reflect it.

- `Workflow/progress.md`: mark tasks done or in progress, add a session log entry, and record any decision as a new ADR.
- `Workflow/data-models.md`: update on any schema change.
- `Workflow/api-interfaces.md`: update on any new or changed interface, payload or event.
- `Workflow/architecture.md`: update on any new library, layer, folder or rule.
- `Workflow/ui-context.md`: update on any new token or shared component.
- `Workflow/project-overview.md`: only the owner changes scope. Propose scope changes; never make them.

Single source of truth: if two docs disagree, **stop and ask** which is correct. Do not guess.

---

## 6. Communication Style With the Owner

- Be direct and concise. Lead with the answer or the plan.
- Explain trade-offs in plain language; the owner makes product decisions.
- When something is marked `[DEFAULT]` in the docs, it was a sensible default the owner has not explicitly confirmed. Mention it if your task depends on it, so the owner can change it.
- If you are unsure, ask. A question costs less than a rewrite.

---

## 7. Definition of Done (checklist)

- [ ] Plan was approved before coding.
- [ ] Code matches the approved plan.
- [ ] Types check (`pnpm typecheck`) and lint passes (`pnpm lint`).
- [ ] Tests added or updated for logic changes (`pnpm test`).
- [ ] Migrations added for any schema change.
- [ ] Relevant `/Workflow` files updated.
- [ ] `Workflow/progress.md` session log updated.
