import { pino } from "pino";
import { describe, expect, it } from "vitest";

import type { AuditEntry } from "../db/auditRepo.ts";
import type { ReminderRequestStore } from "../db/reminderRequestsRepo.ts";
import type { AuthorizedUser } from "./permission.ts";
import { createReminderFlow } from "./reminderFlow.ts";

const logger = pino({ level: "silent" });
const NOW = Date.parse("2026-10-23T09:00:00Z"); // Fri 10:00 Lagos
const LAGOS = "Africa/Lagos";
const ADA_JID = "99887766:3@lid"; // device suffix: the flow stores and matches without it
const ADA_PHONE = "+2348012345678";

type Row = {
  id: string;
  groupId: string;
  requesterJid: string;
  body: string;
  dueAt: Date;
  expiresAt: Date;
  status: "awaiting" | "confirmed" | "declined" | "expired" | "superseded";
  confirmationId: string | null;
};

/** In-memory pending_reminder_requests following migration 0013's confirm rules. */
function memoryRequests(clock: { now: number }) {
  const rows: Row[] = [];
  const posts: { requestId: string; body: string; dueAt: Date }[] = [];
  const store: ReminderRequestStore = {
    create: (r) => {
      for (const row of rows) {
        if (
          row.groupId === r.groupId &&
          row.requesterJid === r.requesterJid &&
          row.status === "awaiting"
        ) {
          row.status = "superseded";
        }
      }
      const id = `r${rows.length + 1}`;
      rows.push({ ...r, id, status: "awaiting", confirmationId: null });
      return Promise.resolve(id);
    },
    setConfirmationMessage: (id, waId) => {
      rows.find((r) => r.id === id)!.confirmationId = waId;
      return Promise.resolve();
    },
    findAwaiting: (groupId, jid, now) =>
      Promise.resolve(
        rows.find(
          (r) =>
            r.groupId === groupId &&
            r.requesterJid === jid &&
            r.status === "awaiting" &&
            r.expiresAt > now,
        ) ?? null,
      ),
    expiredSince: (groupId, jid, since, now) =>
      Promise.resolve(
        rows.some(
          (r) =>
            r.groupId === groupId &&
            r.requesterJid === jid &&
            (r.status === "awaiting" || r.status === "expired") &&
            r.expiresAt > since &&
            r.expiresAt <= now,
        ),
      ),
    confirm: (id, jid) => {
      const row = rows.find(
        (r) =>
          r.id === id &&
          r.requesterJid === jid &&
          r.status === "awaiting" &&
          r.expiresAt.getTime() > clock.now,
      );
      if (!row) return Promise.resolve(null);
      row.status = "confirmed";
      posts.push({ requestId: id, body: row.body, dueAt: row.dueAt });
      return Promise.resolve(`post-${id}`);
    },
    decline: (id) => {
      const row = rows.find((r) => r.id === id && r.status === "awaiting");
      if (row) row.status = "declined";
      return Promise.resolve(Boolean(row));
    },
    expireOverdue: (now) => {
      const hit = rows.filter((r) => r.status === "awaiting" && r.expiresAt <= now);
      for (const r of hit) r.status = "expired";
      return Promise.resolve(hit);
    },
  };
  return { rows, posts, store };
}

function setup(
  users: AuthorizedUser[] = [{ phoneE164: ADA_PHONE, allGroups: true, groupIds: [] }],
) {
  const clock = { now: NOW };
  const requests = memoryRequests(clock);
  const audits: AuditEntry[] = [];
  const flow = createReminderFlow({
    requests: requests.store,
    authorizedUsers: { listActive: () => Promise.resolve(users) },
    audit: {
      record: (entry) => {
        audits.push(entry);
        return Promise.resolve();
      },
    },
    logger,
    now: () => clock.now,
  });
  const request = (extra: object = {}) =>
    flow.handleRequest({
      groupId: "g1",
      permission: "admins_only",
      senderJid: ADA_JID,
      senderPhoneE164: ADA_PHONE,
      sourceWaMessageId: "M1",
      draft: { body: "submit reports", dueAtLocal: "2026-10-23T15:00", confidence: "high" },
      timeZone: LAGOS,
      ...extra,
    });
  const say = (word: "yes" | "no", senderJid = "99887766@lid") =>
    flow.handleReplyWord({ groupId: "g1", senderJid, word, timeZone: LAGOS });
  return { flow, clock, requests, audits, request, say };
}

describe("reminder flow", () => {
  it("repeats the reminder back and remembers the confirmation message", async () => {
    const t = setup();
    const reply = await t.request();
    expect(reply).toMatchObject({
      text: "Reminder for Friday 23 Oct at 3:00 PM GMT+1: submit reports. Reply *yes* to confirm or *no* to cancel.",
      status: "answered",
      action: "reminder_requested",
    });
    await reply.onSent?.("OUT1");
    expect(t.requests.rows[0]).toMatchObject({
      requesterJid: "99887766@lid",
      status: "awaiting",
      confirmationId: "OUT1",
      expiresAt: new Date(NOW + 2 * 60_000),
    });
  });

  it("refuses people not on the list, and hidden numbers, in admins-only groups", async () => {
    const t = setup([]);
    expect(await t.request()).toMatchObject({
      text: "Sorry, only authorized team members can set reminders here.",
      status: "refused",
      action: "refused_unauthorized",
      detail: { reason: "not_authorized" },
    });
    expect(await t.request({ senderPhoneE164: null })).toMatchObject({
      detail: { reason: "no_phone" },
    });
    expect(t.requests.rows).toHaveLength(0);
  });

  it("lets anyone in an any-member group", async () => {
    const t = setup([]);
    expect(await t.request({ permission: "any_member", senderPhoneE164: null })).toMatchObject({
      action: "reminder_requested",
    });
  });

  it("asks again for an unclear or unusable time and saves nothing", async () => {
    const t = setup();
    const draft = (change: object) => ({
      draft: { body: "reports", dueAtLocal: "2026-10-23T15:00", confidence: "high", ...change },
    });
    expect((await t.request(draft({ confidence: "low" }))).text).toContain("exact day and time");
    expect((await t.request(draft({ dueAtLocal: "2026-10-23T10:01" }))).text).toContain("too soon");
    expect((await t.request(draft({ dueAtLocal: "2028-01-01T10:00" }))).text).toContain(
      "up to a year ahead",
    );
    expect(t.requests.rows).toHaveLength(0);
  });

  it("saves the reminder on the requester's yes, once", async () => {
    const t = setup();
    await t.request();
    expect(await t.say("yes")).toMatchObject({
      text: "Done. Reminder set for Friday 23 Oct at 3:00 PM GMT+1.",
      action: "reminder_confirmed",
    });
    expect(t.requests.posts).toEqual([
      { requestId: "r1", body: "submit reports", dueAt: new Date("2026-10-23T14:00:00Z") },
    ]);
    // A second yes is just chat: nothing awaiting, nothing expired.
    expect(await t.say("yes")).toBeNull();
    expect(t.requests.posts).toHaveLength(1);
  });

  it("ignores someone else's yes", async () => {
    const t = setup();
    await t.request();
    expect(await t.say("yes", "55443322@lid")).toBeNull();
    expect(t.requests.rows[0]?.status).toBe("awaiting");
  });

  it("cancels on no", async () => {
    const t = setup();
    await t.request();
    expect(await t.say("no")).toMatchObject({
      text: "Okay, cancelled.",
      action: "reminder_declined",
    });
    expect(t.requests.rows[0]?.status).toBe("declined");
    expect(t.requests.posts).toHaveLength(0);
  });

  it("a new request replaces the old one", async () => {
    const t = setup();
    await t.request();
    await t.request({
      draft: { body: "call the client", dueAtLocal: "2026-10-23T16:00", confidence: "high" },
    });
    expect(t.requests.rows.map((r) => r.status)).toEqual(["superseded", "awaiting"]);
    await t.say("yes");
    expect(t.requests.posts[0]?.body).toBe("call the client");
  });

  it("after 2 minutes: nothing saved, and a late yes is told it expired (P23)", async () => {
    const t = setup();
    await t.request();
    t.clock.now += 2 * 60_000 + 1;
    expect(await t.say("yes")).toMatchObject({
      text: "That request has expired, so nothing was set. Tag me again to set it.",
      action: "reminder_late_reply",
    });
    expect(t.requests.posts).toHaveLength(0);

    await t.flow.expireOverdue();
    expect(t.requests.rows[0]?.status).toBe("expired");
    expect(t.audits).toEqual([
      expect.objectContaining({ action: "reminder_expired", actorType: "system", groupId: "g1" }),
    ]);

    t.clock.now += 10 * 60_000; // long after: just chat again
    expect(await t.say("yes")).toBeNull();
  });
});
