// Background indexing (api-interfaces.md §6, Workflow/Phases/06-Deep-History.md 4.1). Leader-only:
// every 30 s it turns pending training entries, then pending messages, into embeddings so search
// can find them by meaning.
//
// Rules:
// - The bot's own replies, media without a caption and messages under 3 words are `skipped`
//   without an API call (P10).
// - A problem with the account or the service (no key, bad key, no credits, rate limit, timeout,
//   outage) counts against no row: the job waits and tries again next run.
// - A problem with the content (OpenRouter rejects the text or answers in an unexpected shape)
//   counts one attempt per row; after 3 the row is `failed`. A rejected batch is retried one text
//   at a time, so one bad text never fails the others.
import { localDateInTz } from "@soft-agent-support/shared";

import { EMBEDDING_BATCH_MAX, type EmbeddingsClient } from "../ai/embeddings.ts";
import { OpenRouterError } from "../ai/openrouter.ts";
import type { AiSettingsStore } from "../db/aiSettingsRepo.ts";
import type {
  EmbeddingsStore,
  EmbeddingTable,
  PendingMessage,
  PendingTraining,
} from "../db/embeddingsRepo.ts";
import type { UsageStore } from "../db/usageRepo.ts";
import type { Logger } from "../logger.ts";

export const MAX_EMBEDDING_ATTEMPTS = 3;
const MIN_WORDS = 3;
/** Batches per table per run: up to 640 rows every 30 s while a backlog clears. */
const MAX_BATCHES_PER_RUN = 10;

export type EmbeddingJob = {
  start(): void;
  /** Stops the timer and waits for a run in progress. */
  stop(): Promise<void>;
  /** One full run (tests call this directly). */
  runOnce(): Promise<void>;
};

/** Account or service trouble: try again later without blaming the rows. */
class WaitError extends Error {}

/** P10: the bot's replies and messages with too little text are not worth indexing. */
export function shouldIndexMessage(message: Pick<PendingMessage, "isFromBot" | "body">): boolean {
  if (message.isFromBot) return false;
  const words = message.body?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  return words >= MIN_WORDS;
}

export function createEmbeddingJob(options: {
  store: EmbeddingsStore;
  settings: AiSettingsStore;
  embeddings: EmbeddingsClient;
  usage: UsageStore;
  logger: Logger;
  intervalMs?: number;
  batchSize?: number;
  now?: () => number;
}): EmbeddingJob {
  const { store, embeddings, intervalMs = 30_000, batchSize = EMBEDDING_BATCH_MAX } = options;
  const now = options.now ?? Date.now;
  const log = options.logger.child({ module: "embeddings" });
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> | null = null;
  let waitingForKey = false;

  type Row = { id: string; groupId: string; attempts: number; text: string };

  /** Embeds rows; returns the ones that worked. Throws WaitError for account/service trouble. */
  async function embedRows(
    apiKey: string,
    table: EmbeddingTable,
    rows: Row[],
  ): Promise<{ row: Row; vector: number[] }[]> {
    try {
      const result = await embeddings.embed(
        apiKey,
        rows.map((r) => r.text),
      );
      await recordUsage(rows, result.inputTokens, result.costUsd);
      return rows.map((row, i) => ({ row, vector: result.vectors[i]! }));
    } catch (error) {
      if (!(error instanceof OpenRouterError)) throw error;
      const contentProblem = error.failure === "bad_request" || error.failure === "bad_response";
      if (!contentProblem) {
        throw new WaitError(`${error.failure}: ${error.message}`);
      }
      if (rows.length > 1) {
        // Find the bad text: one at a time.
        const results: { row: Row; vector: number[] }[] = [];
        for (const row of rows) results.push(...(await embedRows(apiKey, table, [row])));
        return results;
      }
      log.warn({ table, id: rows[0]!.id, failure: error.failure }, "could not index a row");
      await store.recordFailure(table, rows, MAX_EMBEDDING_ATTEMPTS);
      return [];
    }
  }

  /** Embedding usage is added to each group's daily totals, split by text length. */
  async function recordUsage(rows: Row[], inputTokens: number, costUsd: number) {
    let timezone = "UTC";
    try {
      timezone = (await options.settings.load()).timezone;
    } catch {
      // Keep UTC; the totals still land on a nearby day.
    }
    const usageDate = localDateInTz(new Date(now()), timezone);
    const totalChars = rows.reduce((sum, r) => sum + r.text.length, 0) || 1;
    const byGroup = new Map<string, number>();
    for (const row of rows) {
      byGroup.set(row.groupId, (byGroup.get(row.groupId) ?? 0) + row.text.length / totalChars);
    }
    for (const [groupId, share] of byGroup) {
      await options.usage
        .record({
          groupId,
          usageDate,
          inputTokens: Math.round(inputTokens * share),
          outputTokens: 0,
          costUsd: costUsd * share,
          replies: 0,
        })
        .catch((error: unknown) => log.error({ err: error }, "could not record embedding usage"));
    }
  }

  async function indexTraining(apiKey: string): Promise<number> {
    let done = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const entries = await store.pendingTraining(batchSize);
      if (entries.length === 0) break;
      const byId = new Map<string, PendingTraining>(entries.map((e) => [e.id, e]));
      const rows = entries.map((e) => ({
        id: e.id,
        groupId: e.groupId,
        attempts: e.attempts,
        text: `${e.title}\n${e.content}`,
      }));
      const embedded = await embedRows(apiKey, "knowledge_entries", rows);
      for (const { row, vector } of embedded) {
        await store.saveTraining(byId.get(row.id)!, vector);
        done++;
      }
      // A failed row is still pending: leave it for the next run rather than re-reading it now.
      if (entries.length < batchSize || embedded.length < rows.length) break;
    }
    return done;
  }

  async function indexMessages(apiKey: string): Promise<{ done: number; skipped: number }> {
    let done = 0;
    let skipped = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const messages = await store.pendingMessages(batchSize);
      if (messages.length === 0) break;
      const skip = messages.filter((m) => !shouldIndexMessage(m)).map((m) => m.id);
      await store.markSkipped(skip);
      skipped += skip.length;
      const rows = messages
        .filter((m) => shouldIndexMessage(m))
        .map((m) => ({ id: m.id, groupId: m.groupId, attempts: m.attempts, text: m.body!.trim() }));
      const embedded = await embedRows(apiKey, "group_messages", rows);
      for (const { row, vector } of embedded) {
        await store.saveMessage(row.id, vector);
        done++;
      }
      if (messages.length < batchSize || embedded.length < rows.length) break;
    }
    return { done, skipped };
  }

  async function run() {
    let apiKey: string | null;
    try {
      apiKey = (await options.settings.load()).apiKey;
    } catch (error) {
      log.error({ err: error }, "could not load settings; indexing waits");
      return;
    }
    if (!apiKey) {
      if (!waitingForKey) log.info("no OpenRouter key saved yet; indexing waits");
      waitingForKey = true;
      return;
    }
    waitingForKey = false;

    try {
      const training = await indexTraining(apiKey);
      const messages = await indexMessages(apiKey);
      if (training > 0 || messages.done > 0 || messages.skipped > 0) {
        log.info({ training, messages: messages.done, skipped: messages.skipped }, "indexed");
      }
    } catch (error) {
      if (error instanceof WaitError) {
        log.warn(`indexing paused until the next run (${error.message})`);
        return;
      }
      log.error({ err: error }, "indexing run failed");
    }
  }

  function tick() {
    if (current) return; // the previous run is still going
    current = run().finally(() => {
      current = null;
    });
  }

  return {
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await current;
    },
    runOnce: run,
  };
}
