// Posts due reminders and announcements (api-interfaces.md §8.1, Workflow/Phases/07-Scheduler.md
// 5.2–5.4, ADR-011, ADR-034). Leader-only, every 30 s, and only while WhatsApp is connected.
//
// At most once: a post is claimed (`sending`) before it is sent and finished after, so a crash in
// between leaves it `sending`, which the next session marks `delivery_uncertain` for an admin to
// check. Outcomes follow what WhatsApp saw (P17):
//   sent                               → sent (+ message ID, stored in the group's chat)
//   not connected / worker stopping    → back to scheduled (nothing reached WhatsApp)
//   WhatsApp rejected it               → failed
//   no confirmation in time, or other  → delivery_uncertain (it may be in the group)
//
// Every tick: posts of active groups more than 2 h late → skipped_late; then claim and send,
// at least 3 s apart. A repeating post gets its next date once it leaves `scheduled` for good.
import { randomUUID } from "node:crypto";

import {
  formatScheduledPost,
  nextOccurrence,
  parseRrule,
  timeOfDayKey,
  type Json,
} from "@soft-agent-support/shared";

import { lateNote } from "../assistant/templates.ts";
import type { AiSettingsStore } from "../db/aiSettingsRepo.ts";
import type { AuditStore } from "../db/auditRepo.ts";
import type { ScheduledPost, ScheduledPostStore } from "../db/scheduledPostsRepo.ts";
import type { Logger } from "../logger.ts";
import { SendError, type SendQueue } from "../whatsapp/sendQueue.ts";

/** Older than this when found → skipped, never sent (overview §4.4). */
export const LATE_LIMIT_MS = 2 * 60 * 60_000;
/** Later than this when sent → the late note is added. */
export const LATE_NOTE_AFTER_MS = 2 * 60_000;
const CLAIM_BATCH = 10;
const MAX_BATCHES_PER_TICK = 5;

export type Scheduler = {
  /** Marks a stopped session's leftovers uncertain, then ticks every 30 s. */
  start(): Promise<void>;
  /** Stops the timer and waits for a tick in progress. */
  stop(): Promise<void>;
  /** One tick (tests call this directly). */
  tick(): Promise<void>;
};

export function createScheduler(options: {
  store: ScheduledPostStore;
  send: Pick<SendQueue, "enqueue">;
  /** WhatsApp is connected; nothing is claimed otherwise. */
  isConnected: () => boolean;
  settings: AiSettingsStore;
  audit: AuditStore;
  /** Stores the sent post in group_messages as a bot message (the chat view shows it). */
  recordBotMessage: (groupId: string, waMessageId: string, text: string) => Promise<void>;
  logger: Logger;
  intervalMs?: number;
  staggerMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Scheduler {
  const { store, intervalMs = 30_000, staggerMs = 3_000 } = options;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.logger.child({ module: "scheduler" });
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> | null = null;
  let stopped = false;
  let lastPostAt = Number.NEGATIVE_INFINITY;

  const audit = (action: string, post: ScheduledPost, detail: Record<string, Json> = {}) =>
    options.audit
      .record({
        action,
        actorType: "system",
        actorRef: "scheduler",
        groupId: post.groupId,
        detail: { postId: post.id, kind: post.kind, ...detail },
      })
      .catch((error: unknown) => log.error({ err: error, postId: post.id }, "audit write failed"));

  /** 5.4: the next post of a series, the first date after now (P19). Never twice (unique index). */
  async function scheduleNext(post: ScheduledPost, timeZone: string) {
    if (!post.recurrenceRule) return;
    const rule = parseRrule(post.recurrenceRule);
    if (!rule) {
      log.warn({ postId: post.id, rule: post.recurrenceRule }, "unknown repeat rule; series ends");
      return;
    }
    const after = new Date(Math.max(now(), post.dueAt.getTime()));
    const dueAt = nextOccurrence(rule, timeOfDayKey(post.dueAt, timeZone), after, timeZone);
    try {
      const created = await store.insertNext(post, dueAt);
      if (created) log.info({ postId: post.id, dueAt }, "next post of the series scheduled");
    } catch (error) {
      log.error({ err: error, postId: post.id }, "could not schedule the next post of a series");
    }
  }

  /**
   * Sends one claimed post. "released": nothing reached WhatsApp, it waits for the next tick
   * (and so does the rest of the batch). "done": it left `scheduled` for good.
   */
  async function sendPost(
    post: ScheduledPost,
    token: string,
    groupJid: string | undefined,
    timeZone: string,
  ): Promise<"done" | "released"> {
    if (!groupJid) {
      await store.markFailed(post.id, token, "group not found");
      await audit("post_failed", post, { error: "group not found" });
      return "done";
    }
    const wait = lastPostAt + staggerMs - now();
    if (wait > 0) await sleep(wait);
    if (stopped || !options.isConnected()) {
      await store.release(post.id, token);
      return "released";
    }

    const late = now() - post.dueAt.getTime() > LATE_NOTE_AFTER_MS;
    const body = formatScheduledPost(post.kind, post.body);
    const text = late ? `${body}\n${lateNote(post.dueAt, new Date(now()), timeZone)}` : body;

    let waMessageId: string;
    try {
      ({ waMessageId } = await options.send.enqueue({ groupJid, text }));
    } catch (error) {
      lastPostAt = now();
      const reason = error instanceof SendError ? error.reason : "unknown";
      if (reason === "not_connected" || reason === "stopped") {
        await store.release(post.id, token);
        log.warn({ postId: post.id, reason }, "post not sent; it waits for the next tick");
        return "released";
      }
      const message = error instanceof Error ? error.message : String(error);
      if (reason === "send_failed") {
        await store.markFailed(post.id, token, message);
        await audit("post_failed", post, { error: message.slice(0, 200) });
        log.error({ postId: post.id, err: error }, "WhatsApp rejected the post");
      } else {
        const why =
          reason === "timeout"
            ? "WhatsApp did not confirm in time"
            : `unexpected error: ${message}`;
        await store.markUncertain(post.id, token, why);
        await audit("post_uncertain", post, { reason: why.slice(0, 200) });
        log.error({ postId: post.id, err: error }, "post delivery uncertain");
      }
      return "done";
    }

    lastPostAt = now();
    // The post is in the group. If this write fails it stays `sending`, and the next session
    // marks it uncertain; it is never sent again automatically.
    await store.markSent(post.id, token, waMessageId, late);
    await options
      .recordBotMessage(post.groupId, waMessageId, text)
      .catch((error: unknown) =>
        log.error({ err: error, postId: post.id }, "could not store the sent post"),
      );
    await audit("post_sent", post, { late, waMessageId });
    log.info({ postId: post.id, groupId: post.groupId, late }, "post sent");
    return "done";
  }

  async function tick() {
    if (stopped || !options.isConnected()) return;
    let timeZone: string;
    try {
      timeZone = (await options.settings.load()).timezone;
    } catch (error) {
      log.error({ err: error }, "could not load settings; scheduler waits");
      return;
    }

    // 5.3: too late to be useful.
    for (const post of await store.skipLate(new Date(now() - LATE_LIMIT_MS))) {
      log.warn({ postId: post.id, dueAt: post.dueAt }, "post skipped: more than 2 hours late");
      await audit("post_skipped_late", post, { dueAt: post.dueAt.toISOString() });
      await scheduleNext(post, timeZone);
    }

    for (let batch = 0; batch < MAX_BATCHES_PER_TICK && !stopped; batch++) {
      const token = randomUUID();
      const posts = await store.claim(token, CLAIM_BATCH);
      if (posts.length === 0) return;
      const jids = await store.groupJids([...new Set(posts.map((p) => p.groupId))]);
      for (const [index, post] of posts.entries()) {
        const outcome = await sendPost(post, token, jids.get(post.groupId), timeZone);
        if (outcome === "done") await scheduleNext(post, timeZone);
        else {
          // WhatsApp went away: the rest of this batch waits for the next tick.
          for (const rest of posts.slice(index + 1)) await store.release(rest.id, token);
          return;
        }
      }
      if (posts.length < CLAIM_BATCH) return;
    }
  }

  function runTick() {
    if (current) return; // the previous tick is still sending
    current = tick()
      .catch((error: unknown) => log.error({ err: error }, "scheduler tick failed"))
      .finally(() => {
        current = null;
      });
  }

  return {
    async start() {
      stopped = false;
      // 5.3: only the leader sends, so anything still `sending` belongs to a stopped session.
      try {
        const leftovers = await store.markLeftoverSendingUncertain("worker stopped while sending");
        if (leftovers.length > 0) {
          const timeZone = (await options.settings.load().catch(() => null))?.timezone ?? "UTC";
          for (const post of leftovers) {
            log.warn({ postId: post.id }, "post left mid-send by a stopped session: uncertain");
            await audit("post_uncertain", post, { reason: "worker stopped while sending" });
            await scheduleNext(post, timeZone);
          }
        }
      } catch (error) {
        log.error({ err: error }, "could not check for posts left mid-send");
      }
      if (timer) return;
      timer = setInterval(runTick, intervalMs);
      runTick();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await current;
    },
    tick,
  };
}
