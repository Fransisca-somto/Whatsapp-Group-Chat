import { pino } from "pino";
import { describe, expect, it } from "vitest";

import type { AuditEntry } from "../db/auditRepo.ts";
import type { ScheduledPost, ScheduledPostStore } from "../db/scheduledPostsRepo.ts";
import { SendError, type OutgoingMessage } from "../whatsapp/sendQueue.ts";
import { createScheduler } from "./scheduler.ts";

const logger = pino({ level: "silent" });
const NOW = Date.parse("2026-10-23T08:00:00Z"); // Fri 9:00 AM Lagos
const MINUTE = 60_000;

type Status =
  "scheduled" | "sending" | "sent" | "failed" | "delivery_uncertain" | "skipped_late" | "cancelled";
type Row = ScheduledPost & {
  status: Status;
  token: string | null;
  waMessageId: string | null;
  sentLate: boolean;
  lastError: string | null;
  groupActive: boolean;
};

/** In-memory scheduled_posts with the database's claim, status and one-upcoming-per-series rules. */
function memoryStore(initial: Partial<Row>[]) {
  let next = 1;
  const rows: Row[] = initial.map((r) => ({
    id: `p${next++}`,
    groupId: "g1",
    kind: "announcement",
    body: "Hello team",
    dueAt: new Date(NOW),
    recurrenceRule: null,
    parentPostId: null,
    createdByUserId: "u1",
    status: "scheduled",
    token: null,
    waMessageId: null,
    sentLate: false,
    lastError: null,
    groupActive: true,
    ...r,
  }));
  const copy = (r: Row): ScheduledPost => ({
    id: r.id,
    groupId: r.groupId,
    kind: r.kind,
    body: r.body,
    dueAt: r.dueAt,
    recurrenceRule: r.recurrenceRule,
    parentPostId: r.parentPostId,
    createdByUserId: r.createdByUserId,
  });
  const finish = (id: string, token: string, change: Partial<Row>) => {
    const row = rows.find((r) => r.id === id && r.token === token && r.status === "sending");
    if (row) Object.assign(row, change);
    return Promise.resolve();
  };
  const store: ScheduledPostStore = {
    markLeftoverSendingUncertain: (reason) => {
      const hit = rows.filter((r) => r.status === "sending");
      for (const r of hit) Object.assign(r, { status: "delivery_uncertain", lastError: reason });
      return Promise.resolve(hit.map(copy));
    },
    skipLate: (cutoff) => {
      const hit = rows.filter(
        (r) => r.status === "scheduled" && r.groupActive && r.dueAt.getTime() < cutoff.getTime(),
      );
      for (const r of hit) r.status = "skipped_late";
      return Promise.resolve(hit.map(copy));
    },
    claim: (token, limit) => {
      const hit = rows
        .filter((r) => r.status === "scheduled" && r.groupActive && r.dueAt.getTime() <= now())
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
        .slice(0, limit);
      for (const r of hit) Object.assign(r, { status: "sending", token });
      return Promise.resolve(hit.map(copy));
    },
    groupJids: (ids) => Promise.resolve(new Map(ids.map((id) => [id, `${id}@g.us`]))),
    markSent: (id, token, waMessageId, sentLate) =>
      finish(id, token, { status: "sent", waMessageId, sentLate }),
    markFailed: (id, token, error) => finish(id, token, { status: "failed", lastError: error }),
    markUncertain: (id, token, reason) =>
      finish(id, token, { status: "delivery_uncertain", lastError: reason }),
    release: (id, token) => finish(id, token, { status: "scheduled", token: null }),
    insertNext: (post, dueAt) => {
      const series = post.parentPostId ?? post.id;
      const waiting = rows.some(
        (r) =>
          r.status === "scheduled" &&
          r.recurrenceRule !== null &&
          (r.parentPostId ?? r.id) === series,
      );
      if (waiting) return Promise.resolve(false);
      rows.push({
        ...rows.find((r) => r.id === post.id)!,
        id: `p${next++}`,
        dueAt,
        parentPostId: series,
        status: "scheduled",
        token: null,
        waMessageId: null,
        sentLate: false,
        lastError: null,
      });
      return Promise.resolve(true);
    },
  };
  let clock = NOW;
  const now = () => clock;
  const advance = (ms: number) => {
    clock += ms;
  };
  return { rows, store, now, advance };
}

function setup(
  initial: Partial<Row>[],
  options: {
    sendError?: (n: number) => Error | null;
    connected?: () => boolean;
    expireReminderRequests?: () => Promise<void>;
  } = {},
) {
  const memory = memoryStore(initial);
  const sent: (OutgoingMessage & { at: number })[] = [];
  const audits: AuditEntry[] = [];
  const stored: { groupId: string; waMessageId: string; text: string }[] = [];
  let sends = 0;
  const scheduler = createScheduler({
    store: memory.store,
    send: {
      enqueue: (message) => {
        const error = options.sendError?.(++sends) ?? null;
        if (error) return Promise.reject(error);
        sent.push({ ...message, at: memory.now() });
        return Promise.resolve({ waMessageId: `WA${sent.length}` });
      },
    },
    isConnected: options.connected ?? (() => true),
    expireReminderRequests: options.expireReminderRequests,
    settings: {
      load: () =>
        Promise.resolve({
          companyName: "Acme",
          botName: "Ada",
          timezone: "Africa/Lagos",
          apiKey: null,
          chatModel: null,
          fallbackModel: null,
        }),
    },
    audit: {
      record: (entry) => {
        audits.push(entry);
        return Promise.resolve();
      },
    },
    recordBotMessage: (groupId, waMessageId, text) => {
      stored.push({ groupId, waMessageId, text });
      return Promise.resolve();
    },
    logger,
    now: memory.now,
    sleep: (ms) => {
      memory.advance(ms);
      return Promise.resolve();
    },
  });
  const statusOf = (id: string) => memory.rows.find((r) => r.id === id)?.status;
  return { ...memory, scheduler, sent, audits, stored, statusOf };
}

describe("scheduler", () => {
  it("posts what is due, records it as sent and stores it in the chat", async () => {
    const t = setup([
      { kind: "reminder", body: "Submit the weekly report" },
      { dueAt: new Date(NOW + 10 * MINUTE) }, // not due yet
    ]);
    await t.scheduler.tick();

    expect(t.sent.map((m) => [m.groupJid, m.text])).toEqual([
      ["g1@g.us", "*Reminder:* Submit the weekly report"],
    ]);
    expect(t.sent[0]).not.toHaveProperty("quoted");
    expect(t.rows[0]).toMatchObject({ status: "sent", waMessageId: "WA1", sentLate: false });
    expect(t.statusOf("p2")).toBe("scheduled");
    expect(t.stored).toEqual([
      { groupId: "g1", waMessageId: "WA1", text: "*Reminder:* Submit the weekly report" },
    ]);
    expect(t.audits).toEqual([
      expect.objectContaining({
        action: "post_sent",
        actorType: "system",
        groupId: "g1",
        detail: { postId: "p1", kind: "reminder", late: false, waMessageId: "WA1" },
      }),
    ]);
  });

  it("claims nothing while WhatsApp is disconnected", async () => {
    const t = setup([{}], { connected: () => false });
    await t.scheduler.tick();
    expect(t.sent).toEqual([]);
    expect(t.statusOf("p1")).toBe("scheduled");
  });

  it("expires unconfirmed reminder requests every tick, even while disconnected", async () => {
    let expired = 0;
    const t = setup([{}], {
      connected: () => false,
      expireReminderRequests: () => {
        expired++;
        return Promise.resolve();
      },
    });
    await t.scheduler.tick();
    expect(expired).toBe(1);
    expect(t.sent).toEqual([]);
  });

  it("spaces posts at least 3 seconds apart", async () => {
    const t = setup([{}, { groupId: "g2" }, { groupId: "g3" }]);
    await t.scheduler.tick();
    const gaps = t.sent.slice(1).map((m, i) => m.at - t.sent[i]!.at);
    expect(gaps).toEqual([3_000, 3_000]);
  });

  it("adds the late note after 2 minutes, and skips posts more than 2 hours late", async () => {
    const t = setup([
      { dueAt: new Date(NOW - 30 * MINUTE), body: "Stand-up" },
      { dueAt: new Date(NOW - 3 * 60 * MINUTE), body: "Too old" },
      { dueAt: new Date(NOW - 3 * 60 * MINUTE), groupActive: false }, // paused group: left alone
    ]);
    await t.scheduler.tick();

    expect(t.sent.map((m) => m.text)).toEqual([
      "Stand-up\n(Sent late: this was scheduled for 8:30 AM.)",
    ]);
    expect(t.rows[0]).toMatchObject({ status: "sent", sentLate: true });
    expect(t.statusOf("p2")).toBe("skipped_late");
    expect(t.statusOf("p3")).toBe("scheduled");
    expect(t.audits.map((a) => a.action)).toEqual(["post_skipped_late", "post_sent"]);
  });

  it("names the day in the late note when it was due on another day", async () => {
    const t = setup([{ dueAt: new Date(NOW - 90 * MINUTE) }]); // 7:30 AM Lagos, same day
    t.advance(16 * 60 * MINUTE); // now 1:00 AM the next day; the post is far too late
    await t.scheduler.tick();
    expect(t.statusOf("p1")).toBe("skipped_late");

    const u = setup([{ dueAt: new Date(Date.parse("2026-10-23T22:50:00Z")) }]); // 11:50 PM
    u.advance(Date.parse("2026-10-23T23:10:00Z") - NOW); // 12:10 AM Saturday
    await u.scheduler.tick();
    expect(u.sent[0]?.text).toBe(
      "Hello team\n(Sent late: this was scheduled for Fri 23 Oct 11:50 PM.)",
    );
  });

  it("puts a post back when nothing reached WhatsApp, and the rest of the batch waits", async () => {
    const t = setup([{}, { groupId: "g2" }], {
      sendError: () => new SendError("not_connected", "WhatsApp is not connected"),
    });
    await t.scheduler.tick();
    expect(t.statusOf("p1")).toBe("scheduled");
    expect(t.statusOf("p2")).toBe("scheduled");
    expect(t.audits).toEqual([]);
  });

  it("marks a rejected post failed, and an unconfirmed one uncertain, never retrying", async () => {
    const t = setup([{}, { groupId: "g2" }], {
      sendError: (n) =>
        n === 1
          ? new SendError("send_failed", "sendMessage failed: not-authorized")
          : new SendError("timeout", "no confirmation within 15000 ms"),
    });
    await t.scheduler.tick();
    expect(t.rows[0]).toMatchObject({
      status: "failed",
      lastError: "sendMessage failed: not-authorized",
    });
    expect(t.rows[1]).toMatchObject({
      status: "delivery_uncertain",
      lastError: "WhatsApp did not confirm in time",
    });
    expect(t.audits.map((a) => a.action)).toEqual(["post_failed", "post_uncertain"]);

    await t.scheduler.tick();
    expect(t.sent).toEqual([]); // nothing is sent again
  });

  it("on start, marks posts a stopped session left mid-send as uncertain", async () => {
    const t = setup([{ status: "sending", token: "old" }, { dueAt: new Date(NOW + 60 * MINUTE) }]);
    await t.scheduler.start();
    await t.scheduler.stop();
    expect(t.rows[0]).toMatchObject({
      status: "delivery_uncertain",
      lastError: "worker stopped while sending",
    });
    expect(t.audits[0]).toMatchObject({ action: "post_uncertain" });
    expect(t.sent).toEqual([]);
  });

  describe("repeating posts", () => {
    const DAILY = "FREQ=DAILY";

    it("schedules the next date once the post is sent", async () => {
      const t = setup([{ recurrenceRule: DAILY }]);
      await t.scheduler.tick();
      expect(t.rows).toHaveLength(2);
      expect(t.rows[1]).toMatchObject({
        status: "scheduled",
        parentPostId: "p1",
        recurrenceRule: DAILY,
        dueAt: new Date(NOW + 24 * 60 * MINUTE), // 9:00 AM tomorrow
      });
    });

    it("keeps the series going after a skip, from the next date after now", async () => {
      const t = setup([
        {
          recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
          dueAt: new Date(NOW - 3 * 24 * 60 * MINUTE),
        },
      ]); // Tue 9:00, three days ago
      await t.scheduler.tick();
      expect(t.statusOf("p1")).toBe("skipped_late");
      expect(t.rows[1]?.dueAt).toEqual(new Date("2026-10-26T08:00:00Z")); // Monday 9:00, not a backlog
    });

    it("continues after a failure, but not when the post was only put back", async () => {
      const failed = setup([{ recurrenceRule: DAILY }], {
        sendError: () => new SendError("send_failed", "rejected"),
      });
      await failed.scheduler.tick();
      expect(failed.rows).toHaveLength(2);

      const released = setup([{ recurrenceRule: DAILY }], {
        sendError: () => new SendError("not_connected", "offline"),
      });
      await released.scheduler.tick();
      expect(released.rows).toHaveLength(1);
    });

    it("never forks a series: a second next date is refused", async () => {
      const t = setup([
        { recurrenceRule: DAILY },
        { recurrenceRule: DAILY, parentPostId: "p1", dueAt: new Date(NOW + 24 * 60 * MINUTE) },
      ]);
      await t.scheduler.tick();
      expect(t.rows.filter((r) => r.status === "scheduled")).toHaveLength(1);
    });
  });
});
