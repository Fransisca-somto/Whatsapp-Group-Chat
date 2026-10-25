// Phase 7, task 7.2: five people tag the bot at the same moment in one group. The real pipeline,
// per-group queue and send queue run together; only WhatsApp, the database and the AI are
// stand-ins. The AI answers later questions *faster*, which is exactly when replies could get
// out of order or attached to the wrong question if anything were not serial per group.
import type { WAMessage } from "baileys";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import type { InboundGroupMessage } from "@soft-agent-support/shared";

import { EMBEDDING_DIMENSIONS } from "../ai/embeddings.ts";
import type { ChatRequest, OpenRouterClient } from "../ai/openrouter.ts";
import type { GroupRecord } from "../db/groupsRepo.ts";
import { memoryAudit, memoryMessages } from "../ingest/testStores.ts";
import type { SocketLike } from "../whatsapp/connection.ts";
import { createSendQueue } from "../whatsapp/sendQueue.ts";
import { createGroupQueue, type GroupQueue } from "./groupQueue.ts";
import { createAssistant } from "./pipeline.ts";

const logger = pino({ level: "silent" });
const BOT = { jid: "2348000000000@s.whatsapp.net", lid: "11112222@lid" };
const SALES: GroupRecord = {
  id: "g1",
  jid: "120363000000000001@g.us",
  name: "Sales",
  status: "active",
};
const OPS: GroupRecord = {
  id: "g2",
  jid: "120363000000000002@g.us",
  name: "Ops",
  status: "active",
};
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function setup() {
  const messages = memoryMessages();
  const audit = memoryAudit();
  /** What reached "WhatsApp", in order. */
  const delivered: { group: string; text: string; quotedId: string | undefined; at: number }[] = [];

  const sock = {
    sendPresenceUpdate: () => Promise.resolve(),
    sendMessage: (jid: string, content: { text: string }, options: { quoted?: WAMessage }) => {
      delivered.push({
        group: jid,
        text: content.text,
        quotedId: options.quoted?.key.id ?? undefined,
        at: Date.now(),
      });
      return Promise.resolve({ key: { id: `OUT${delivered.length}` } });
    },
  };
  // The real send queue, minus the human-like pauses (they only slow the test down).
  const send = createSendQueue({
    getSocket: () => sock as unknown as SocketLike,
    logger,
    sleep: () => Promise.resolve(),
  });

  // "Question N" is classified as a question, then answered after (6 - N) * 15 ms.
  const ai: OpenRouterClient = {
    chat: async (request: ChatRequest) => {
      const isIntent = request.messages[0]?.content.startsWith("You classify") ?? false;
      const asked = /Question (\w+)/.exec(request.messages.at(-1)?.content ?? "")?.[1] ?? "?";
      if (!isIntent) await wait((6 - (Number(asked) || 5)) * 15);
      return {
        text: isIntent ? '{"intent":"question"}' : `Answer to question ${asked}.`,
        model: "test/model",
        usedFallback: false,
        truncated: false,
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0,
      };
    },
  };

  const runs: Promise<void>[] = [];
  const realQueue = createGroupQueue(logger);
  const queue: GroupQueue = {
    run: (groupId, task) => {
      const run = realQueue.run(groupId, task);
      runs.push(run);
      return run;
    },
  };

  const assistant = createAssistant({
    groups: {
      assistantSettings: () =>
        Promise.resolve({
          aiEnabled: true,
          allowGeneralKnowledge: true,
          dailyReplyCap: 200,
          botInstructions: null,
          reminderPermission: "admins_only",
        }),
    },
    messages: messages.store,
    knowledge: {
      listActive: () =>
        Promise.resolve([{ title: "Hours", content: "Open 8am to 5pm.", updatedAt: "2026-10-01" }]),
    },
    search: {
      searchHistory: () => Promise.resolve([]),
      searchTraining: () => Promise.resolve([]),
    },
    embeddings: {
      embed: () =>
        Promise.resolve({
          vectors: [new Array<number>(EMBEDDING_DIMENSIONS).fill(0)],
          inputTokens: 1,
          costUsd: 0,
        }),
    },
    usage: { record: () => Promise.resolve(), repliesOn: () => Promise.resolve(0) },
    settings: {
      load: () =>
        Promise.resolve({
          companyName: "Acme",
          botName: "Ada",
          timezone: "Africa/Lagos",
          apiKey: "sk-or-v1-test",
          chatModel: "test/model",
          fallbackModel: null,
        }),
    },
    audit: audit.store,
    ai,
    reminders: {
      handleRequest: () => Promise.reject(new Error("not used")),
      handleReplyWord: () => Promise.resolve(null),
      expireOverdue: () => Promise.resolve(),
    },
    send,
    getBot: () => BOT,
    logger,
    queue,
  });

  /** A tag from person `n` in `group`, delivered the way ingest hands it on. */
  const tag = (group: GroupRecord, id: string, n: number, text: string) => {
    const message: InboundGroupMessage = {
      waMessageId: id,
      groupJid: group.jid,
      senderJid: `5550000${n}@lid`,
      senderPhoneE164: `+23480000000${n}`,
      senderName: `Person ${n}`,
      type: "text",
      body: `@11112222 ${text}`,
      quotedWaMessageId: null,
      quotedParticipantJid: null,
      mentionedJids: [BOT.lid],
      sentAt: new Date(),
      isFromBot: false,
    };
    void messages.store.insertIfNew({
      groupId: group.id,
      waMessageId: id,
      senderJid: message.senderJid,
      senderPhoneE164: message.senderPhoneE164,
      senderName: message.senderName,
      isFromBot: false,
      type: "text",
      body: message.body,
      quotedWaMessageId: null,
      mentionsBot: true,
      sentAt: message.sentAt,
      handledStatus: "received",
    });
    assistant.handle(message, group, { key: { id } } as WAMessage);
  };

  return { tag, delivered, audit, runs };
}

describe("load test: 5 simultaneous tags in one group (7.2)", () => {
  it("answers each in arrival order, quoting its own question, without mixing them up", async () => {
    const t = setup();
    for (let n = 1; n <= 5; n++) t.tag(SALES, `S${n}`, n, `Question ${n}: when do we open?`);
    await Promise.all(t.runs);

    const replies = t.delivered.filter((d) => d.group === SALES.jid);
    expect(replies.map((r) => [r.quotedId, r.text])).toEqual([
      ["S1", "Answer to question 1."],
      ["S2", "Answer to question 2."],
      ["S3", "Answer to question 3."],
      ["S4", "Answer to question 4."],
      ["S5", "Answer to question 5."],
    ]);
    const outcomes = t.audit.entries.filter((e) => e.groupId === SALES.id);
    expect(outcomes.map((e) => [e.sourceWaMessageId, e.action])).toEqual([
      ["S1", "answered"],
      ["S2", "answered"],
      ["S3", "answered"],
      ["S4", "answered"],
      ["S5", "answered"],
    ]);
  });

  it("doesn't hold up another group while one group's tags are being handled", async () => {
    const t = setup();
    for (let n = 1; n <= 5; n++) t.tag(SALES, `S${n}`, n, `Question ${n}: when do we open?`);
    t.tag(OPS, "O1", 9, "Question 5: where is the office?"); // the fastest answer
    await Promise.all(t.runs);

    const order = t.delivered.map((d) => d.quotedId);
    expect(order.indexOf("O1")).toBeLessThan(order.indexOf("S5"));
    expect(order.filter((id) => id?.startsWith("S"))).toEqual(["S1", "S2", "S3", "S4", "S5"]);
  });
});
