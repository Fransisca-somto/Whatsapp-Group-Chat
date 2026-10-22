import { describe, expect, it } from "vitest";

import { formatHistoryLine, formatTraining, stripBotMention } from "./buildContext.ts";

const bot = { jid: "2348000000000@s.whatsapp.net", lid: "11112222@lid" };

describe("formatTraining", () => {
  const entries = [
    { title: "Newest", content: "a".repeat(40), updatedAt: "2026-10-22T10:00:00Z" },
    { title: "Middle", content: "b".repeat(40), updatedAt: "2026-10-21T10:00:00Z" },
    { title: "Oldest", content: "c".repeat(40), updatedAt: "2026-10-20T10:00:00Z" },
  ];

  it("includes every entry under the budget, with headings", () => {
    const result = formatTraining(entries);
    expect(result.included).toBe(3);
    expect(result.dropped).toEqual([]);
    expect(result.text).toContain("### Newest\n" + "a".repeat(40));
  });

  it("drops the oldest-edited entries first when over budget", () => {
    const result = formatTraining(entries, 110);
    expect(result.included).toBe(2);
    expect(result.dropped).toEqual(["Oldest"]);
  });
});

describe("formatHistoryLine", () => {
  const base = {
    senderName: "Ada",
    senderPhoneE164: "+2348012345678",
    isFromBot: false,
    type: "text" as const,
    body: "Is the office open\non Friday?",
    sentAt: "2026-10-09T14:05:00Z",
  };

  it("shows local time, name and one-line text", () => {
    expect(formatHistoryLine(base, "Africa/Lagos", "Assistant")).toBe(
      "[Fri 9 Oct 3:05 PM] Ada: Is the office open on Friday?",
    );
  });

  it("names the bot and labels media", () => {
    expect(
      formatHistoryLine({ ...base, isFromBot: true, body: "Yes." }, "Africa/Lagos", "Assistant"),
    ).toMatch(/\] Assistant: Yes\.$/);
    expect(
      formatHistoryLine(
        { ...base, type: "image", body: null, senderName: null },
        "Africa/Lagos",
        "A",
      ),
    ).toMatch(/\] \+2348012345678: \(photo\)$/);
  });
});

describe("stripBotMention", () => {
  it("removes the bot's phone or LID mention, keeps other mentions", () => {
    expect(stripBotMention("@2348000000000 what time do we open?", bot)).toBe(
      "what time do we open?",
    );
    expect(stripBotMention("hey @11112222, ask @2349999999999 about it", bot)).toBe(
      "hey , ask @2349999999999 about it",
    );
  });

  it("returns empty text for a bare tag", () => {
    expect(stripBotMention("@11112222", bot)).toBe("");
  });
});
