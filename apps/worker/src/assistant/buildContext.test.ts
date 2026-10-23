import { describe, expect, it } from "vitest";

import {
  formatHistoryLine,
  formatOlderMessages,
  formatTraining,
  keywordQuery,
  stripBotMention,
} from "./buildContext.ts";

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

describe("keywordQuery", () => {
  it("keeps the meaningful words, joined with or", () => {
    expect(keywordQuery("What did we decide about the weekly reports?")).toBe(
      "decide or weekly or reports",
    );
  });

  it("drops short words, repeats and search syntax", () => {
    expect(keywordQuery('"reports" -friday OR reports, is it ok?')).toBe("reports or friday");
  });

  it("keeps non-English letters and numbers", () => {
    expect(keywordQuery("Où est la réunion 2026?")).toBe("est or réunion or 2026");
  });

  it("is empty when nothing meaningful is left", () => {
    expect(keywordQuery("what is it?")).toBe("");
  });
});

describe("formatOlderMessages", () => {
  const match = (id: string, sentAt: string, score: number) => ({
    waMessageId: id,
    senderName: id === "m2" ? null : "Ada",
    senderPhoneE164: "+2348012345678",
    body: `message ${id}`,
    sentAt,
    score,
  });
  const matches = [
    match("m1", "2026-10-05T08:00:00Z", 0.03), // best match
    match("m2", "2026-10-01T08:00:00Z", 0.02),
    match("m3", "2026-10-20T08:00:00Z", 0.01), // inside the last-15 window
  ];

  it("drops matches inside the recent window and shows the rest oldest first", () => {
    expect(formatOlderMessages(matches, "2026-10-19T00:00:00Z", "Africa/Lagos")).toEqual([
      "[Thu 1 Oct 9:00 AM] +2348012345678: message m2",
      "[Mon 5 Oct 9:00 AM] Ada: message m1",
    ]);
  });

  it("keeps only the best matches up to the limit", () => {
    expect(formatOlderMessages(matches, "2026-10-19T00:00:00Z", "Africa/Lagos", 1)).toEqual([
      "[Mon 5 Oct 9:00 AM] Ada: message m1",
    ]);
  });
});
