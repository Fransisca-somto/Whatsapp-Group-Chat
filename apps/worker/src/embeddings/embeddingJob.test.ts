import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS, type EmbeddingsClient } from "../ai/embeddings.ts";
import { OpenRouterError } from "../ai/openrouter.ts";
import type { AssistantSettings } from "../db/aiSettingsRepo.ts";
import type {
  EmbeddingsStore,
  EmbeddingTable,
  PendingMessage,
  PendingTraining,
} from "../db/embeddingsRepo.ts";
import type { UsageEntry } from "../db/usageRepo.ts";
import { createEmbeddingJob, shouldIndexMessage } from "./embeddingJob.ts";

const logger = pino({ level: "silent" });
const SETTINGS: AssistantSettings = {
  companyName: "Acme",
  botName: "Ada",
  timezone: "Africa/Lagos",
  apiKey: "sk-or-v1-test",
  chatModel: "anthropic/claude-haiku-5.5",
  fallbackModel: null,
};

type Status = "pending" | "done" | "skipped" | "failed";

/** An in-memory store with the database's status and attempt rules. */
function memoryStore(training: PendingTraining[], messages: PendingMessage[]) {
  const status = new Map<string, Status>();
  const attempts = new Map<string, number>();
  for (const row of [...training, ...messages]) {
    status.set(row.id, "pending");
    attempts.set(row.id, row.attempts);
  }
  const pending = <T extends { id: string; attempts: number }>(rows: T[], limit: number) =>
    rows
      .filter((r) => status.get(r.id) === "pending")
      .slice(0, limit)
      .map((r) => ({ ...r, attempts: attempts.get(r.id)! }));
  const store: EmbeddingsStore = {
    pendingTraining: (limit) => Promise.resolve(pending(training, limit)),
    pendingMessages: (limit) => Promise.resolve(pending(messages, limit)),
    saveTraining: (entry) => {
      status.set(entry.id, "done");
      return Promise.resolve();
    },
    saveMessage: (id) => {
      status.set(id, "done");
      return Promise.resolve();
    },
    markSkipped: (ids) => {
      for (const id of ids) status.set(id, "skipped");
      return Promise.resolve();
    },
    recordFailure: (_table: EmbeddingTable, rows, max) => {
      for (const row of rows) {
        attempts.set(row.id, row.attempts + 1);
        if (row.attempts + 1 >= max) status.set(row.id, "failed");
      }
      return Promise.resolve();
    },
  };
  return { store, status, attempts };
}

const message = (id: string, body: string | null, extra: Partial<PendingMessage> = {}) => ({
  id,
  groupId: "g1",
  isFromBot: false,
  type: "text" as const,
  body,
  attempts: 0,
  ...extra,
});
const entry = (id: string, groupId = "g1"): PendingTraining => ({
  id,
  groupId,
  title: `Title ${id}`,
  content: "Some content here.",
  attempts: 0,
  updatedAt: "2026-10-23T10:00:00Z",
});

function embeddingsMock(behaviour?: (texts: string[]) => Error | null) {
  const calls: string[][] = [];
  const embed = vi.fn((_key: string, texts: string[]) => {
    calls.push(texts);
    const error = behaviour?.(texts);
    if (error) return Promise.reject(error);
    return Promise.resolve({
      vectors: texts.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0.1)),
      inputTokens: 100,
      costUsd: 0.000002,
    });
  });
  const client: EmbeddingsClient = { embed };
  return { client, calls, embed };
}

function job(
  store: EmbeddingsStore,
  embeddings: EmbeddingsClient,
  settings: Partial<AssistantSettings> = {},
  batchSize = 64,
) {
  const usage: UsageEntry[] = [];
  const instance = createEmbeddingJob({
    store,
    settings: { load: () => Promise.resolve({ ...SETTINGS, ...settings }) },
    embeddings,
    usage: {
      record: (e) => {
        usage.push(e);
        return Promise.resolve();
      },
      repliesOn: () => Promise.resolve(0),
    },
    logger,
    batchSize,
    now: () => Date.parse("2026-10-23T09:00:00Z"),
  });
  return { job: instance, usage };
}

describe("shouldIndexMessage (P10)", () => {
  it("skips the bot, media without a caption and messages under 3 words", () => {
    expect(shouldIndexMessage({ isFromBot: true, body: "Office opens at 8am daily" })).toBe(false);
    expect(shouldIndexMessage({ isFromBot: false, body: null })).toBe(false);
    expect(shouldIndexMessage({ isFromBot: false, body: "  ok thanks " })).toBe(false);
    expect(shouldIndexMessage({ isFromBot: false, body: "Reports on Friday" })).toBe(true);
  });
});

describe("embedding job", () => {
  it("indexes training first, then messages, and skips what is not worth indexing", async () => {
    const memory = memoryStore(
      [entry("k1")],
      [
        message("m1", "Let's move the report deadline to Friday"),
        message("m2", "ok"),
        message("m3", "Here is the answer you asked for", { isFromBot: true }),
        message("m4", null, { type: "image" }),
      ],
    );
    const { client, calls } = embeddingsMock();
    await job(memory.store, client).job.runOnce();

    expect(calls).toEqual([
      ["Title k1\nSome content here."],
      ["Let's move the report deadline to Friday"],
    ]);
    expect(Object.fromEntries(memory.status)).toEqual({
      k1: "done",
      m1: "done",
      m2: "skipped",
      m3: "skipped",
      m4: "skipped",
    });
  });

  it("waits without a key: no call, nothing marked", async () => {
    const memory = memoryStore([entry("k1")], [message("m1", "Reports due on Friday")]);
    const { client, embed } = embeddingsMock();
    await job(memory.store, client, { apiKey: null }).job.runOnce();
    expect(embed).not.toHaveBeenCalled();
    expect([...memory.status.values()]).toEqual(["pending", "pending"]);
  });

  it("does not count account or service failures against the rows", async () => {
    const memory = memoryStore([entry("k1")], [message("m1", "Reports due on Friday")]);
    const { client, embed } = embeddingsMock(
      () => new OpenRouterError("no_credits", 402, "Insufficient credits"),
    );
    const { job: instance } = job(memory.store, client);
    for (let i = 0; i < 5; i++) await instance.runOnce();
    expect(memory.status.get("k1")).toBe("pending");
    expect(memory.attempts.get("k1")).toBe(0);
    expect(embed).toHaveBeenCalledTimes(5); // stops at the first failure each run
  });

  it("retries a rejected batch one text at a time, and fails a bad row after 3 runs", async () => {
    const memory = memoryStore(
      [],
      [message("m1", "Reports due on Friday"), message("m2", "this text is rejected")],
    );
    const { client } = embeddingsMock((texts) =>
      texts.some((t) => t.includes("rejected"))
        ? new OpenRouterError("bad_request", 400, "bad input")
        : null,
    );
    const { job: instance } = job(memory.store, client);

    await instance.runOnce();
    expect(memory.status.get("m1")).toBe("done");
    expect(memory.status.get("m2")).toBe("pending");
    expect(memory.attempts.get("m2")).toBe(1);

    await instance.runOnce();
    await instance.runOnce();
    expect(memory.status.get("m2")).toBe("failed");
    expect(memory.attempts.get("m2")).toBe(3);
  });

  it("works through a backlog in batches within one run", async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      message(`m${i}`, `message number ${i} about reports`),
    );
    const memory = memoryStore([], messages);
    const { client, calls } = embeddingsMock();
    await job(memory.store, client, {}, 2).job.runOnce();
    expect(calls.map((c) => c.length)).toEqual([2, 2, 1]);
    expect([...memory.status.values()].every((s) => s === "done")).toBe(true);
  });

  it("adds usage to each group's day in the company timezone, with no replies", async () => {
    const memory = memoryStore([entry("k1", "g1"), entry("k2", "g2")], []);
    const { client } = embeddingsMock();
    const { job: instance, usage } = job(memory.store, client);
    await instance.runOnce();
    expect(usage.map((u) => [u.groupId, u.usageDate, u.inputTokens, u.replies])).toEqual([
      ["g1", "2026-10-23", 50, 0],
      ["g2", "2026-10-23", 50, 0],
    ]);
  });

  it("stop() waits for the run in progress", async () => {
    const memory = memoryStore([entry("k1")], []);
    let release: (() => void) | null = null;
    const client: EmbeddingsClient = {
      embed: (_key, texts) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              vectors: texts.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)),
              inputTokens: 1,
              costUsd: 0,
            });
        }),
    };
    const { job: instance } = job(memory.store, client);
    instance.start();
    await vi.waitFor(() => expect(release).not.toBeNull());
    let stopped = false;
    const stopping = instance.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release!();
    await stopping;
    expect(memory.status.get("k1")).toBe("done");
  });
});
