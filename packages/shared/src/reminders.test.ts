import { describe, expect, it } from "vitest";

import { checkReminderDraft, reminderTimeInTz, replyWord } from "./reminders.ts";

const LAGOS = "Africa/Lagos";
const NOW = new Date("2026-10-23T09:00:00Z"); // Fri 10:00 Lagos

describe("replyWord (P21)", () => {
  it("recognises a whole-message yes or no, in any case, with mentions and punctuation", () => {
    for (const text of ["yes", "Yes!", " YEP ", "ok.", "@11112222 yes", "confirm", "y"]) {
      expect(replyWord(text)).toBe("yes");
    }
    for (const text of ["no", "No.", "cancel", "STOP", "@2348000000000 n"]) {
      expect(replyWord(text)).toBe("no");
    }
  });

  it("ignores anything more than the word", () => {
    for (const text of ["yes please", "yes, make it 4pm", "no idea", "okay team", "", null]) {
      expect(replyWord(text)).toBeNull();
    }
  });
});

describe("checkReminderDraft", () => {
  const draft = {
    body: " submit reports ",
    dueAtLocal: "2026-10-23T15:00",
    confidence: "high" as const,
  };

  it("accepts a clear time and trims the text", () => {
    expect(checkReminderDraft(draft, LAGOS, NOW)).toEqual({
      ok: true,
      body: "submit reports",
      dueAt: new Date("2026-10-23T14:00:00Z"),
    });
  });

  it("refuses unclear, too soon, too far and bad text", () => {
    const reason = (change: object) => {
      const result = checkReminderDraft({ ...draft, ...change }, LAGOS, NOW);
      return result.ok ? "ok" : result.reason;
    };
    expect(reason({ confidence: "low" })).toBe("unclear_time");
    expect(reason({ dueAtLocal: "Friday" })).toBe("unclear_time");
    expect(reason({ dueAtLocal: "2026-10-23T10:02" })).toBe("too_soon"); // 2 minutes ahead
    expect(reason({ dueAtLocal: "2026-10-23T10:03" })).toBe("ok"); // exactly 3 minutes
    expect(reason({ dueAtLocal: "2026-10-23T09:00" })).toBe("too_soon"); // in the past
    expect(reason({ dueAtLocal: "2027-11-01T10:00" })).toBe("too_far");
    expect(reason({ body: "   " })).toBe("bad_text");
    expect(reason({ body: "x".repeat(501) })).toBe("bad_text");
  });
});

describe("reminderTimeInTz", () => {
  it("spells out the day, date, time and zone", () => {
    expect(reminderTimeInTz(new Date("2026-10-30T14:00:00Z"), LAGOS)).toBe(
      "Friday 30 Oct at 3:00 PM GMT+1",
    );
  });
});
