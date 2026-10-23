# Step 06 — Phase 4: Deep History (Search by Meaning and Keyword)

> Covers `progress.md` Phase 4, tasks **4.1–4.4**.
> Status: **plan, awaiting owner approval.** No code is written until the owner approves (CLAUDE.md §1).
> Branch: `phase-4`, created from `phase-3` (or from `main` once `phase-3` is merged). One commit per task.
> Phase rule: Phase 4 starts before Phase 3 is marked ✅ only with the owner's explicit approval; the four remaining Phase 3 checks can run in parallel.

## Goal
The bot can find older conversations and the right training entries by meaning and by keyword, always inside the asking group only. "What did we decide about the reports?" finds the message from two weeks ago, and a group with a large handbook no longer hits the 12,000-character training limit. Groups that set "Keep messages for N days" have older messages deleted automatically.

## What was checked before planning (2026-10-23)
- OpenRouter has an embeddings API (`POST /api/v1/embeddings`) that works with the company's saved key: the live test returned 1,536 numbers per text for `openai/text-embedding-3-small`, the exact size the database columns were built for (`vector(1536)`). Cost: $0.02 per 1M tokens, about $0.0000003 for two sentences.
- So no new account, key or setting is needed: search uses the OpenRouter key from the Settings page (extends ADR-027).
- The search functions already exist (`search_group_history`, `search_knowledge`, both requiring the group, migrations 0006 and 0009) and skip the meaning branch when no question embedding is given.
- **Gap found:** the keyword branch uses `websearch_to_tsquery`, which requires **every** word to match. "What did we decide about the reports" would almost never match. The worker will send only the meaningful words joined with OR (see 4.3).

## How it works (plain language)
1. **Indexing (background).** Every 30 seconds the worker takes new or edited training entries and new text messages, turns each into an "embedding" (a list of numbers describing its meaning) through OpenRouter, and saves it next to the text.
2. **Searching (per question).** When someone tags the bot, the worker turns the question into an embedding too, then asks the database for the closest matches by meaning and by keyword, in this group only, and merges the two lists.
3. **Answering.** The best matches are added to what the AI reads, labelled as older messages and training, alongside the last 15 messages. The answer rules (ADR-029, ADR-030) do not change.

## Proposed decisions (owner to confirm)
| # | Proposal | Recommendation |
|---|---|---|
| P8 | **Training: send all when it fits, search when it does not.** If the group's active training fits in 12,000 characters, keep sending all of it (best answers for small handbooks). Above that, send the top 8 entries found by search. | Yes (better than always sending only the top 5) |
| P9 | **Older history: top 8 related messages** from before the last-15 window, each with its date and sender. | Yes |
| P10 | **The bot's own replies are not indexed** (status `skipped`): they repeat the training and would crowd out real decisions. Staff messages with at least 3 words are indexed; media without a caption and very short messages are skipped. | Yes |
| P11 | **Embedding model fixed to `openai/text-embedding-3-small`** (confirms Open Default D9). Not changeable from the dashboard: another model has a different size and would need every message re-indexed. | Yes |
| P12 | **Retention runs inside the database** (a daily `pg_cron` job, like the offline alert), not in the worker, so it runs even when the worker is down. It logs one audit row per group it cleans. | Yes |
| P13 | **Indexing status on the Train tab:** each entry shows a small "Indexing…" marker until it is searchable, and "Not searchable" if indexing failed 3 times. | Yes |

## Tasks

### 4.1 Indexing (embedding pipeline)
- `ai/embeddings.ts`: OpenRouter embeddings client (plain `fetch`, 20 s timeout, up to 64 texts per call, validated response, cost recorded). Same key and failure kinds as the chat client.
- `embeddings/embeddingJob.ts`: leader-only, every 30 s:
  - up to 64 `pending` training entries (title + content), then up to 64 `pending` messages;
  - messages that are from the bot, media without a caption, or under 3 words → `skipped` without an API call;
  - success → `embedding` saved, status `done`;
  - failure → `embedding_attempts` + 1; after 3 attempts → `failed` (logged; the Train tab shows it);
  - no OpenRouter key saved → the job waits silently (one log line), nothing is marked failed.
- Existing messages and training (already `pending`) are indexed by the same job, 64 at a time, so the backlog clears within minutes.
- Usage: embedding tokens and cost are added to `ai_usage_daily` per group (`replies = 0`).
- `db/embeddingsRepo.ts`: claim pending rows, save embeddings, record failures.
- The `EMBEDDINGS_API_KEY` and `EMBEDDINGS_MODEL` environment variables are removed (the key is the Settings key; the model is fixed, P11).

### 4.2 Search functions
- Already in the database. Migration 0011 adds what indexing needs (see Database) and leaves the search logic unchanged.
- `db/searchRepo.ts`: `searchHistory(groupId, embedding | null, keywords, limit)` and `searchTraining(groupId, …)`. The group is required in the type, so there is no way to search without it.

### 4.3 Retrieval in answers
- The question is embedded once per tagged message (only for the `question` intent).
- **Keyword text:** meaningful words of the question (3+ letters, common English filler words removed), joined with `or` for `websearch_to_tsquery`, so any matching word counts and the ranking puts the best matches first.
- **If embedding fails** (OpenRouter down, no credit): keyword-only search, and the answer still goes out. Logged.
- **Training (P8):** all active entries if they fit the 12,000-character budget, otherwise the top 8 from `searchTraining`.
- **History (P9):** top 8 from `searchHistory`, minus anything already in the last 15 messages, formatted `[date time] Name: text`, in a new `<older_messages>` reference block, labelled as reference data, not instructions.
- The audit detail gains `historyMatches` and `trainingMode` (`all` / `search`) so the Audit log shows what the bot looked at, never the text itself.

### 4.4 Retention
- `purge_expired_messages()` (database function, service role only): for each group with `retention_days` set, delete its messages older than that many days, in batches; write a `messages_purged` audit row (system) with the count when anything was deleted.
- `pg_cron` job `purge-expired-messages`, daily at 03:00 UTC (04:00 Lagos). The dashboard's existing "Keep messages for (days)" field drives it.

### Dashboard
- Train tab: "Indexing…" / "Not searchable" markers (P13).
- Audit log: labels for `messages_purged`; the answer summary shows history matches.
- No new settings.

## Database (migration `0011_search_indexing_and_retention.sql`)
- `knowledge_entries.embedding_attempts int not null default 0`; `group_messages.embedding_attempts int not null default 0`.
- `group_messages_guard()` also allows `embedding_attempts` to change (it already allows `embedding` and `embedding_status`).
- `knowledge_entries_reset_embedding()` also resets `embedding_attempts` to 0 when title or content change.
- Partial indexes on `embedding_status = 'pending'` for both tables, so the 30 s job stays fast as history grows.
- `purge_expired_messages()` + the `pg_cron` job (P12).
- Regenerate `database.types.ts`.

## Files
**Worker**
- `src/ai/embeddings.ts` (+ test).
- `src/embeddings/embeddingJob.ts` (+ test).
- `src/db/embeddingsRepo.ts`, `src/db/searchRepo.ts`.
- `src/assistant/buildContext.ts` (+ test): keyword text, training mode, older-messages block.
- `src/assistant/prompts/answer.ts` (+ test): `<older_messages>` block.
- `src/assistant/pipeline.ts` (+ test): embed the question, search, fall back to keywords.
- `src/env.ts` (+ test): remove the embeddings variables.
- `src/index.ts`: start and stop the job with the leader session.

**Dashboard**
- `app/(app)/groups/[id]/TrainTab.tsx` (+ test), `lib/training.ts`: indexing markers.
- `lib/audit.ts` (+ test): `messages_purged`, history matches.

**Shared and database**
- `packages/shared/src/schemas/openrouter.ts`: embeddings response schema.
- `supabase/migrations/0011_search_indexing_and_retention.sql`; `packages/shared/src/database.types.ts`.
- `supabase/tests/phase4_isolation.sql`: a rolled-back SQL check the owner runs in the SQL Editor (two test groups, one search per group, proves no cross-group results).

**Root**
- `.env.example`: remove the embeddings variables.

## Docs to update
- `progress.md`: Phase 4 tasks, session log, ADR-031 (search via the OpenRouter key and a fixed model; extends ADR-027, amends ADR-024, confirms D9) and ADR-032 (retention in the database, P12); remove D9 and D10 from Open Defaults if confirmed.
- `data-models.md`: new columns, trigger changes, partial indexes, purge function and cron job.
- `api-interfaces.md`: §6 Embeddings (OpenRouter, batch size, status rules), §5.2 answer context (training mode, older messages, keyword text), audit actions.
- `architecture.md`: §1 AI (embeddings) row, §2 `embeddings/` folder, §8 env variables.
- `ui-context.md`: Train tab markers.

## Alternatives considered
- **A separate embeddings provider (OpenAI key):** another account and key for each company; OpenRouter already offers the same model with the saved key.
- **A free embedding model** (e.g. NVIDIA Nemotron): rate limits and privacy concerns, a different vector size, and the paid model costs almost nothing.
- **Always the top 5 training entries (original spec):** small handbooks would lose context that sending everything keeps; P8 uses search only when it is needed.
- **Retention in the worker (original spec):** stops when the worker is down; `pg_cron` is already used for the offline alert.
- **Changing the SQL keyword logic:** possible, but building the OR query in the worker keeps the tested search functions unchanged.

## Risks / open questions
- **Dates in questions.** "On Monday" is not understood as a date in Phase 4: search finds related messages by meaning and words, and each result shows its date, so the AI can usually pick the right one. Real date filtering would be a later improvement.
- **Index delay:** a new message becomes searchable within about 30 s (it is in the last-15 window anyway).
- **Cost:** indexing 10,000 messages costs roughly $0.01. Each question adds one tiny embedding call and about 8 short messages to the prompt (roughly +$0.00005 per answer).
- **Backlog:** existing messages are indexed in the first minutes after the worker starts.

## Verify
**Automated**
- Embeddings client (batching, timeout, invalid response, failure kinds); job (skip rules, done, attempts, failed after 3, waits without a key); keyword text builder; training mode switch; older-messages block skips duplicates of the last 15; pipeline falls back to keyword-only search; search always called with the asking group's id; dashboard markers and audit labels.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, dashboard build.

**Database (after the owner applies 0011)**
- The agent checks that the backlog is indexed (`done` / `skipped` counts) and the cron job exists.
- The owner runs `supabase/tests/phase4_isolation.sql` in the SQL Editor: results come only from the asking group.

**Live (owner, in "Softwirelex group")**
1. Post a few real-looking messages, e.g. "Let's move the weekly report deadline to Friday", "Agreed, reports on Friday from now on".
2. Send 15+ other messages so those fall out of the last-15 window (or wait for normal chat).
3. Tag the bot: "What did we decide about the weekly reports?" → it answers from the older messages ("Friday").
4. Ask with different words: "When are reports due now?" → found by meaning.
5. Ask a training question that is not in the newest entries → still answered.
6. Audit log shows `historyMatches` for those answers.

## Out of scope for this step
- Date-aware search ("last Monday" as a filter).
- Searching across groups (never, by design).
- Media understanding (images, voice notes).
- Changing the embedding model from the dashboard.

## Exit criteria (from progress.md)
- "What did we decide about the reports on Monday?" finds the right messages by meaning and by keyword.
- No cross-group leakage, tested.
- Retention deletes messages older than a group's setting.
- All checks pass and the docs above are updated.
