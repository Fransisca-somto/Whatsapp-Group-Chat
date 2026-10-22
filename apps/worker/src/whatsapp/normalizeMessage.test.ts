import type { WAMessage } from "baileys";
import { describe, expect, it } from "vitest";

import { normalizeMessage } from "./normalizeMessage.ts";

const GROUP = "120363000000000001@g.us";
const BOT = "2348000000000@s.whatsapp.net";

function msg(message: object | null, key: object = {}, extra: object = {}): WAMessage {
  return {
    key: { remoteJid: GROUP, id: "MSG1", participant: "99887766@lid", fromMe: false, ...key },
    message,
    messageTimestamp: 1_760_800_000,
    pushName: "Ada",
    ...extra,
  };
}

describe("normalizeMessage", () => {
  it("reads a plain text message", () => {
    const result = normalizeMessage(
      msg({ conversation: "hello team" }, { participantAlt: "2348012345678@s.whatsapp.net" }),
      BOT,
    );
    expect(result).toEqual({
      waMessageId: "MSG1",
      groupJid: GROUP,
      senderJid: "99887766@lid",
      senderAltJid: "2348012345678@s.whatsapp.net",
      senderName: "Ada",
      type: "text",
      body: "hello team",
      quotedWaMessageId: null,
      quotedParticipantJid: null,
      mentionedJids: [],
      sentAt: new Date(1_760_800_000 * 1000),
      isFromBot: false,
    });
  });

  it("reads mentions and the quoted message from an extended text", () => {
    const result = normalizeMessage(
      msg({
        extendedTextMessage: {
          text: "@bot what time is the meeting?",
          contextInfo: {
            mentionedJid: ["55443322@lid"],
            stanzaId: "QUOTED1",
            participant: "55443322@lid",
          },
        },
      }),
      BOT,
    );
    expect(result).toMatchObject({
      type: "text",
      body: "@bot what time is the meeting?",
      mentionedJids: ["55443322@lid"],
      quotedWaMessageId: "QUOTED1",
      quotedParticipantJid: "55443322@lid",
    });
  });

  it("keeps media as metadata with its caption", () => {
    expect(normalizeMessage(msg({ imageMessage: { caption: "the report" } }), BOT)).toMatchObject({
      type: "image",
      body: "the report",
    });
    expect(normalizeMessage(msg({ audioMessage: { seconds: 4 } }), BOT)).toMatchObject({
      type: "audio",
      body: null,
    });
    expect(normalizeMessage(msg({ stickerMessage: {} }), BOT)).toMatchObject({ type: "sticker" });
    expect(normalizeMessage(msg({ locationMessage: {} }), BOT)).toMatchObject({ type: "other" });
  });

  it("unwraps disappearing and view-once messages", () => {
    expect(
      normalizeMessage(msg({ ephemeralMessage: { message: { conversation: "secret" } } }), BOT),
    ).toMatchObject({ type: "text", body: "secret" });
    expect(
      normalizeMessage(
        msg({ viewOnceMessageV2: { message: { imageMessage: { caption: "once" } } } }),
        BOT,
      ),
    ).toMatchObject({ type: "image", body: "once" });
  });

  it("skips reactions, deletes, edits and system stubs", () => {
    expect(normalizeMessage(msg({ reactionMessage: { text: "👍" } }), BOT)).toBeNull();
    expect(normalizeMessage(msg({ protocolMessage: { type: 0 } }), BOT)).toBeNull();
    expect(normalizeMessage(msg(null, {}, { messageStubType: 27 }), BOT)).toBeNull();
  });

  it("ignores private chats", () => {
    expect(
      normalizeMessage(
        msg({ conversation: "hi" }, { remoteJid: "2348012345678@s.whatsapp.net" }),
        BOT,
      ),
    ).toBeNull();
  });

  it("uses the bot's JID as sender for its own messages", () => {
    expect(
      normalizeMessage(
        msg({ conversation: "Done." }, { fromMe: true, participant: undefined }),
        BOT,
      ),
    ).toMatchObject({ senderJid: BOT, isFromBot: true });
  });

  it("treats a blank text as no body", () => {
    expect(normalizeMessage(msg({ conversation: "   " }), BOT)).toMatchObject({ body: null });
  });
});
