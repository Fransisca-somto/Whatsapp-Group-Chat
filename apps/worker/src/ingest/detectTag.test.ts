import { describe, expect, it } from "vitest";

import { detectTag } from "./detectTag.ts";

const bot = { jid: "2348000000000@s.whatsapp.net", lid: "11112222@lid" };
const base = { mentionedJids: [] as string[], quotedParticipantJid: null, isFromBot: false };

describe("detectTag", () => {
  it("detects an @mention by phone JID or by LID, ignoring device suffixes", () => {
    expect(detectTag({ ...base, mentionedJids: ["2348000000000@s.whatsapp.net"] }, bot)).toBe(true);
    expect(detectTag({ ...base, mentionedJids: ["11112222:7@lid"] }, bot)).toBe(true);
  });

  it("detects a reply to one of the bot's messages", () => {
    expect(detectTag({ ...base, quotedParticipantJid: "11112222@lid" }, bot)).toBe(true);
  });

  it("ignores mentions of other people and untagged messages", () => {
    expect(detectTag({ ...base, mentionedJids: ["99887766@lid"] }, bot)).toBe(false);
    expect(detectTag({ ...base, quotedParticipantJid: "99887766@lid" }, bot)).toBe(false);
    expect(detectTag(base, bot)).toBe(false);
  });

  it("never treats the bot's own messages as tags", () => {
    expect(detectTag({ ...base, isFromBot: true, mentionedJids: ["11112222@lid"] }, bot)).toBe(
      false,
    );
  });

  it("works before the bot's LID is known", () => {
    const noLid = { jid: bot.jid, lid: null };
    expect(detectTag({ ...base, mentionedJids: ["11112222@lid"] }, noLid)).toBe(false);
    expect(detectTag({ ...base, mentionedJids: [bot.jid] }, noLid)).toBe(true);
  });
});
