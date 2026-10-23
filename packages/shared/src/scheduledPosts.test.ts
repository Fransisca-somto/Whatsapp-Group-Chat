import { describe, expect, it } from "vitest";

import { formatScheduledPost, resolveDueAt } from "./scheduledPosts.ts";
import { scheduledPostInputSchema } from "./schemas/scheduledPost.ts";

const LAGOS = "Africa/Lagos";
const NOW = new Date("2026-10-23T09:00:00Z"); // Fri 10:00 in Lagos

describe("formatScheduledPost", () => {
  it("labels reminders and sends announcements as written", () => {
    expect(formatScheduledPost("reminder", " Submit the weekly report ")).toBe(
      "*Reminder:* Submit the weekly report",
    );
    expect(formatScheduledPost("announcement", "Office closes at 3pm today.")).toBe(
      "Office closes at 3pm today.",
    );
  });
});

describe("resolveDueAt", () => {
  it("converts a one-off time from the company timezone", () => {
    const result = resolveDueAt({ dueAtLocal: "2026-10-23T15:00", repeat: null }, LAGOS, NOW);
    expect(result).toEqual({ ok: true, dueAt: new Date("2026-10-23T14:00:00Z") });
  });

  it("starts a repeating post on the first matching day", () => {
    // Saturday 9:00 with "weekdays" starts on Monday.
    const result = resolveDueAt(
      { dueAtLocal: "2026-10-24T09:00", repeat: { kind: "weekdays" } },
      LAGOS,
      NOW,
    );
    expect(result).toEqual({ ok: true, dueAt: new Date("2026-10-26T08:00:00Z") });
  });

  it("keeps a chosen start that already matches the rule", () => {
    const result = resolveDueAt(
      { dueAtLocal: "2026-10-23T17:00", repeat: { kind: "daily" } },
      LAGOS,
      NOW,
    );
    expect(result).toEqual({ ok: true, dueAt: new Date("2026-10-23T16:00:00Z") });
  });

  it("needs at least a minute ahead and at most a year", () => {
    expect(resolveDueAt({ dueAtLocal: "2026-10-23T10:00", repeat: null }, LAGOS, NOW)).toEqual({
      ok: false,
      error: "Pick a time at least a minute from now.",
    });
    expect(resolveDueAt({ dueAtLocal: "2027-11-01T10:00", repeat: null }, LAGOS, NOW)).toEqual({
      ok: false,
      error: "Pick a time within the next year.",
    });
  });
});

describe("scheduledPostInputSchema", () => {
  const valid = {
    groupId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
    kind: "announcement",
    body: "Hello team",
    dueAtLocal: "2026-10-23T15:00",
    repeat: null,
  };

  it("accepts a one-off or repeating post", () => {
    expect(scheduledPostInputSchema.safeParse(valid).success).toBe(true);
    expect(
      scheduledPostInputSchema.safeParse({ ...valid, repeat: { kind: "weekly", days: [1, 3] } })
        .success,
    ).toBe(true);
  });

  it("rejects empty or over-long text and a missing time", () => {
    const issue = (input: object) =>
      scheduledPostInputSchema.safeParse({ ...valid, ...input }).error?.issues[0]?.message;
    expect(issue({ body: "   " })).toBe("Write the message");
    expect(issue({ body: "x".repeat(2001) })).toBe("Keep it under 2,000 characters");
    expect(issue({ dueAtLocal: "" })).toBe("Pick a date and time");
  });
});
