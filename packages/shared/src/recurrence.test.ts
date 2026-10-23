import { describe, expect, it } from "vitest";

import {
  describeRepeat,
  nextOccurrence,
  parseRrule,
  repeatRuleSchema,
  repeatRuleToRrule,
  type RepeatRule,
} from "./recurrence.ts";

const LAGOS = "Africa/Lagos"; // UTC+1, no daylight saving
const LONDON = "Europe/London"; // daylight saving ends Sun 25 Oct 2026

/** Lagos wall-clock time for an instant, to keep expectations readable. */
const lagos = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

describe("RRULE presets", () => {
  const cases: [RepeatRule, string][] = [
    [{ kind: "daily" }, "FREQ=DAILY"],
    [{ kind: "weekdays" }, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    [{ kind: "weekly", days: [3, 1] }, "FREQ=WEEKLY;BYDAY=MO,WE"],
    [{ kind: "weekly", days: [0] }, "FREQ=WEEKLY;BYDAY=SU"],
    [{ kind: "monthly", day: 15 }, "FREQ=MONTHLY;BYMONTHDAY=15"],
    [{ kind: "monthly", day: "last" }, "FREQ=MONTHLY;BYMONTHDAY=-1"],
  ];

  it.each(cases)("writes %j as %s and reads it back", (rule, rrule) => {
    expect(repeatRuleToRrule(rule)).toBe(rrule);
    const back = parseRrule(rrule);
    expect(back && repeatRuleToRrule(back)).toBe(rrule);
  });

  it("reads Monday to Friday as weekdays, in any order", () => {
    expect(parseRrule("FREQ=WEEKLY;BYDAY=FR,MO,TU,WE,TH")).toEqual({ kind: "weekdays" });
  });

  it("rejects anything outside the presets", () => {
    for (const rrule of [
      "FREQ=HOURLY",
      "FREQ=DAILY;INTERVAL=2",
      "FREQ=WEEKLY",
      "FREQ=WEEKLY;BYDAY=XX",
      "FREQ=WEEKLY;BYDAY=MO,MO",
      "FREQ=MONTHLY;BYMONTHDAY=31",
      "FREQ=MONTHLY;BYMONTHDAY=0",
      "FREQ=DAILY;FREQ=DAILY",
      "",
    ]) {
      expect(parseRrule(rrule)).toBeNull();
    }
  });

  it("validates form input", () => {
    expect(repeatRuleSchema.safeParse({ kind: "weekly", days: [] }).success).toBe(false);
    expect(repeatRuleSchema.safeParse({ kind: "monthly", day: 29 }).success).toBe(false);
    expect(repeatRuleSchema.safeParse({ kind: "monthly", day: "last" }).success).toBe(true);
  });
});

describe("nextOccurrence", () => {
  // Fri 23 Oct 2026, 10:00 in Lagos.
  const friMorning = new Date("2026-10-23T09:00:00Z");

  it("daily: later today if the time is still ahead, else tomorrow", () => {
    expect(lagos(nextOccurrence({ kind: "daily" }, "17:00", friMorning, LAGOS))).toBe(
      "Fri 23 Oct, 17:00",
    );
    expect(lagos(nextOccurrence({ kind: "daily" }, "09:00", friMorning, LAGOS))).toBe(
      "Sat 24 Oct, 09:00",
    );
  });

  it("weekdays: skips the weekend", () => {
    expect(lagos(nextOccurrence({ kind: "weekdays" }, "09:00", friMorning, LAGOS))).toBe(
      "Mon 26 Oct, 09:00",
    );
  });

  it("weekly: the next chosen day", () => {
    const rule: RepeatRule = { kind: "weekly", days: [3] };
    expect(lagos(nextOccurrence(rule, "08:30", friMorning, LAGOS))).toBe("Wed 28 Oct, 08:30");
  });

  it("monthly: that day, or the real last day of each month", () => {
    expect(lagos(nextOccurrence({ kind: "monthly", day: 15 }, "09:00", friMorning, LAGOS))).toBe(
      "Sun 15 Nov, 09:00",
    );
    const last: RepeatRule = { kind: "monthly", day: "last" };
    const oct = nextOccurrence(last, "17:00", friMorning, LAGOS);
    expect(lagos(oct)).toBe("Sat 31 Oct, 17:00");
    const nov = nextOccurrence(last, "17:00", oct, LAGOS);
    expect(lagos(nov)).toBe("Mon 30 Nov, 17:00");
    const feb = nextOccurrence(last, "17:00", new Date("2027-02-01T00:00:00Z"), LAGOS);
    expect(lagos(feb)).toBe("Sun 28 Feb, 17:00");
  });

  it("is strictly after the given time", () => {
    const at = new Date("2026-10-23T08:00:00Z"); // exactly 09:00 Lagos
    expect(lagos(nextOccurrence({ kind: "daily" }, "09:00", at, LAGOS))).toBe("Sat 24 Oct, 09:00");
  });

  it("keeps the wall-clock time across a daylight-saving change", () => {
    const sat = nextOccurrence(
      { kind: "daily" },
      "09:00",
      new Date("2026-10-24T00:00:00Z"),
      LONDON,
    );
    const sun = nextOccurrence({ kind: "daily" }, "09:00", sat, LONDON);
    expect(sat.toISOString()).toBe("2026-10-24T08:00:00.000Z"); // BST, UTC+1
    expect(sun.toISOString()).toBe("2026-10-25T09:00:00.000Z"); // GMT, UTC+0
  });
});

describe("describeRepeat", () => {
  const due = "2026-10-26T08:00:00Z"; // 9:00 AM Lagos

  it("names the pattern and the time", () => {
    expect(describeRepeat({ kind: "daily" }, due, LAGOS)).toBe("Every day at 9:00 AM");
    expect(describeRepeat({ kind: "weekdays" }, due, LAGOS)).toBe("Every weekday at 9:00 AM");
    expect(describeRepeat({ kind: "weekly", days: [5, 1, 3] }, due, LAGOS)).toBe(
      "Every Monday, Wednesday and Friday at 9:00 AM",
    );
    expect(describeRepeat({ kind: "monthly", day: 1 }, due, LAGOS)).toBe(
      "Monthly on the 1st at 9:00 AM",
    );
    expect(describeRepeat({ kind: "monthly", day: 22 }, due, LAGOS)).toBe(
      "Monthly on the 22nd at 9:00 AM",
    );
    expect(describeRepeat({ kind: "monthly", day: 11 }, due, LAGOS)).toBe(
      "Monthly on the 11th at 9:00 AM",
    );
    expect(describeRepeat({ kind: "monthly", day: "last" }, due, LAGOS)).toBe(
      "Monthly on the last day at 9:00 AM",
    );
  });
});
