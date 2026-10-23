import type { WAMessage } from "baileys";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import type { GroupStatus } from "@soft-agent-support/shared";

import { createGroupDirectory } from "./groupDirectory.ts";
import { createInboundHandler } from "./handleInbound.ts";
import { memoryAudit, memoryGroups, memoryMessages } from "./testStores.ts";

const logger = pino({ level: "silent" });
const GROUP = "120363000000000001@g.us";
const bot = { jid: "2348000000000@s.whatsapp.net", lid: "11112222@lid" };

function raw(id: string, message: object, key: object = {}): WAMessage {
  return {
    key: {
      remoteJid: GROUP,
      id,
      participant: "99887766@lid",
      participantAlt: "2348012345678@s.whatsapp.net",
      fromMe: false,
      ...key,
    },
    message,
    messageTimestamp: 1_760_800_000,
    pushName: "Ada",
  };
}

function setup(status: GroupStatus | null) {
  const groups = memoryGroups(status ? [{ jid: GROUP, name: "Team", status }] : []);
  const messages = memoryMessages();
  const onTagged = vi.fn();
  const onUnknownGroup = vi.fn(() => Promise.resolve(null));
  let clock = 0;
  const handler = createInboundHandler({
    directory: createGroupDirectory({ store: groups.store, audit: memoryAudit().store, logger }),
    messages: messages.store,
    groups: groups.store,
    lookupPhone: () => Promise.resolve(null),
    getBot: () => bot,
    onUnknownGroup,
    onTagged,
    logger,
    now: () => (clock += 1_000),
  });
  return { handler, messages, groups, onTagged, onUnknownGroup };
}

describe("inbound group messages", () => {
  it("stores messages from active groups with the sender's phone", async () => {
    const t = setup("active");
    await t.handler.handle(raw("M1", { conversation: "morning all" }));
    expect(t.messages.rows).toHaveLength(1);
    expect(t.messages.rows[0]).toMatchObject({
      groupId: "g1",
      waMessageId: "M1",
      senderPhoneE164: "+2348012345678",
      senderName: "Ada",
      type: "text",
      body: "morning all",
      mentionsBot: false,
      handledStatus: null,
    });
    expect(t.groups.touchActivity).toHaveBeenCalledOnce();
  });

  it("stores messages from paused groups too (history continues; the bot stays quiet)", async () => {
    const t = setup("paused");
    await t.handler.handle(raw("M1", { conversation: "hello" }));
    expect(t.messages.rows).toHaveLength(1);
  });

  it.each<GroupStatus>(["pending", "removed", "archived"])(
    "stores nothing from %s groups",
    async (status) => {
      const t = setup(status);
      await t.handler.handle(raw("M1", { conversation: "hello" }));
      expect(t.messages.rows).toHaveLength(0);
    },
  );

  it("asks to register a group it has never seen, and stores nothing until approved", async () => {
    const t = setup(null);
    await t.handler.handle(raw("M1", { conversation: "hello" }));
    expect(t.onUnknownGroup).toHaveBeenCalledWith(GROUP);
    expect(t.messages.rows).toHaveLength(0);
  });

  it("stores a message delivered twice only once, and handles a tag only once", async () => {
    const t = setup("active");
    const tagged = raw("M1", {
      extendedTextMessage: { text: "@bot hi", contextInfo: { mentionedJid: [bot.lid] } },
    });
    await t.handler.handle(tagged);
    await t.handler.handle(tagged);
    expect(t.messages.rows).toHaveLength(1);
    expect(t.onTagged).toHaveBeenCalledOnce();
  });

  it("flags tagged messages as received and hands them on", async () => {
    const t = setup("active");
    await t.handler.handle(
      raw("M1", {
        extendedTextMessage: {
          text: "replying to the bot",
          contextInfo: { stanzaId: "BOTMSG", participant: bot.jid },
        },
      }),
    );
    expect(t.messages.rows[0]).toMatchObject({ mentionsBot: true, handledStatus: "received" });
    expect(t.onTagged).toHaveBeenCalledWith(
      expect.objectContaining({ waMessageId: "M1", quotedWaMessageId: "BOTMSG" }),
      expect.objectContaining({ id: "g1" }),
      expect.anything(),
    );
    // The raw message is passed on so the reply can quote it.
    const rawArgument = t.onTagged.mock.calls[0]?.[2] as WAMessage | undefined;
    expect(rawArgument?.key.id).toBe("M1");
  });

  it("stores the bot's own messages without treating them as tags", async () => {
    const t = setup("active");
    await t.handler.handle(
      raw("M1", { conversation: "Done." }, { fromMe: true, participant: undefined }),
    );
    expect(t.messages.rows[0]).toMatchObject({
      isFromBot: true,
      senderJid: bot.jid,
      senderPhoneE164: "+2348000000000",
      mentionsBot: false,
    });
    expect(t.onTagged).not.toHaveBeenCalled();
  });

  it("stores an unknown phone as null when only a LID is available", async () => {
    const t = setup("active");
    await t.handler.handle(raw("M1", { conversation: "hi" }, { participantAlt: undefined }));
    expect(t.messages.rows[0]).toMatchObject({ senderJid: "99887766@lid", senderPhoneE164: null });
  });

  it("ignores reactions and private chats", async () => {
    const t = setup("active");
    await t.handler.handle(raw("M1", { reactionMessage: { text: "👍" } }));
    await t.handler.handle(
      raw("M2", { conversation: "dm" }, { remoteJid: "2348012345678@s.whatsapp.net" }),
    );
    expect(t.messages.rows).toHaveLength(0);
  });

  it("updates group activity at most once a minute", async () => {
    const t = setup("active");
    for (const id of ["M1", "M2", "M3"]) await t.handler.handle(raw(id, { conversation: id }));
    expect(t.groups.touchActivity).toHaveBeenCalledOnce();
  });
});
