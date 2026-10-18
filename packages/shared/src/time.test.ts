import { describe, expect, it } from "vitest";

import { formatInCompanyTz, nextWeekdayOccurrence, utcToZoned, zonedLocalToUtc } from "./time.ts";

const LAGOS = "Africa/Lagos"; // UTC+1 all year, no DST
const NEW_YORK = "America/New_York"; // DST starts 2026-03-08

describe("formatInCompanyTz", () => {
  it("formats in the company timezone, not UTC", () => {
    expect(formatInCompanyTz(new Date("2026-10-09T14:00:00Z"), LAGOS)).toMatch(
      /^Fri 9 Oct, 3:00 PM \S+/,
    );
  });

  it("shows the DST-correct abbreviation", () => {
    expect(formatInCompanyTz("2026-10-09T19:00:00Z", NEW_YORK)).toBe("Fri 9 Oct, 3:00 PM EDT");
    expect(formatInCompanyTz("2026-01-09T20:00:00Z", NEW_YORK)).toBe("Fri 9 Jan, 3:00 PM EST");
  });
});

describe("zonedLocalToUtc", () => {
  it("converts Lagos wall time to UTC", () => {
    expect(zonedLocalToUtc("2026-10-09T15:00", LAGOS).toISOString()).toBe(
      "2026-10-09T14:00:00.000Z",
    );
  });

  it("uses the offset in force on that date across a DST change", () => {
    expect(zonedLocalToUtc("2026-03-07T09:00", NEW_YORK).toISOString()).toBe(
      "2026-03-07T14:00:00.000Z",
    );
    expect(zonedLocalToUtc("2026-03-09T09:00", NEW_YORK).toISOString()).toBe(
      "2026-03-09T13:00:00.000Z",
    );
  });

  it("rejects malformed input", () => {
    expect(() => zonedLocalToUtc("Friday 3pm", LAGOS)).toThrow();
    expect(() => zonedLocalToUtc("2026-10-09 15:00", LAGOS)).toThrow();
  });
});

describe("utcToZoned", () => {
  it("exposes wall-clock fields in the company timezone", () => {
    const zoned = utcToZoned("2026-10-09T23:30:00Z", LAGOS);
    expect(zoned.getDate()).toBe(10);
    expect(zoned.getHours()).toBe(0);
    expect(zoned.getMinutes()).toBe(30);
  });
});

describe("nextWeekdayOccurrence", () => {
  // 2026-10-09 is a Friday.
  it("returns today when the time has not passed yet", () => {
    const now = new Date("2026-10-09T13:00:00Z"); // Fri 14:00 Lagos
    expect(nextWeekdayOccurrence(5, "15:00", LAGOS, now).toISOString()).toBe(
      "2026-10-09T14:00:00.000Z",
    );
  });

  it("returns next week when the time has passed today", () => {
    const now = new Date("2026-10-09T15:00:00Z"); // Fri 16:00 Lagos
    expect(nextWeekdayOccurrence(5, "15:00", LAGOS, now).toISOString()).toBe(
      "2026-10-16T14:00:00.000Z",
    );
  });

  it("treats exactly now as passed", () => {
    const now = new Date("2026-10-09T14:00:00Z"); // Fri 15:00 Lagos
    expect(nextWeekdayOccurrence(5, "15:00", LAGOS, now).toISOString()).toBe(
      "2026-10-16T14:00:00.000Z",
    );
  });

  it("finds a later weekday this week", () => {
    const now = new Date("2026-10-09T13:00:00Z");
    expect(nextWeekdayOccurrence(1, "09:00", LAGOS, now).toISOString()).toBe(
      "2026-10-12T08:00:00.000Z",
    );
  });

  it("uses the company-timezone date, not the UTC date", () => {
    const now = new Date("2026-10-09T23:30:00Z"); // already Sat 00:30 in Lagos
    expect(nextWeekdayOccurrence(6, "09:00", LAGOS, now).toISOString()).toBe(
      "2026-10-10T08:00:00.000Z",
    );
  });

  it("applies the new offset when the occurrence is after a DST change", () => {
    const now = new Date("2026-03-06T15:00:00Z"); // Fri 10:00 EST
    expect(nextWeekdayOccurrence(1, "09:00", NEW_YORK, now).toISOString()).toBe(
      "2026-03-09T13:00:00.000Z",
    );
  });

  it("rejects a malformed time", () => {
    expect(() => nextWeekdayOccurrence(5, "3pm", LAGOS, new Date())).toThrow();
    expect(() => nextWeekdayOccurrence(5, "24:00", LAGOS, new Date())).toThrow();
  });
});
