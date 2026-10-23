// Repeating posts (Workflow/Phases/07-Scheduler.md P14, ADR-033). A series repeats at the same
// wall-clock time in the company timezone, so 9:00 stays 9:00 across daylight-saving changes.
// Rules are stored as standard RRULE text (`scheduled_posts.recurrence_rule`), but only these
// presets are accepted:
//
//   Daily                     FREQ=DAILY
//   Weekdays (Mon–Fri)        FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
//   Weekly on chosen days     FREQ=WEEKLY;BYDAY=MO,WE
//   Monthly on a day (1–28)   FREQ=MONTHLY;BYMONTHDAY=15
//   Monthly on the last day   FREQ=MONTHLY;BYMONTHDAY=-1
//
// Days 29–31 are not offered: RRULE skips months without that day, which surprises people.
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

import { timeOfDayInTz, zonedLocalToUtc, type Weekday } from "./time.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const WORKWEEK: Weekday[] = [1, 2, 3, 4, 5];
/** Monday first, the order people read a week in. */
const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

const weekdaySchema = z.union([0, 1, 2, 3, 4, 5, 6].map((d) => z.literal(d as Weekday)));

export const repeatRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }),
  z.object({ kind: z.literal("weekdays") }),
  z.object({
    kind: z.literal("weekly"),
    days: z.array(weekdaySchema).min(1, "Pick at least one day").max(7),
  }),
  z.object({
    kind: z.literal("monthly"),
    day: z.union([z.number().int().min(1).max(28), z.literal("last")]),
  }),
]);
export type RepeatRule = z.infer<typeof repeatRuleSchema>;

function sortedDays(days: Weekday[]): Weekday[] {
  return WEEK_ORDER.filter((d) => days.includes(d));
}

/** The RRULE text stored in the database. */
export function repeatRuleToRrule(rule: RepeatRule): string {
  switch (rule.kind) {
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return `FREQ=WEEKLY;BYDAY=${WORKWEEK.map((d) => RRULE_DAYS[d]).join(",")}`;
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${sortedDays(rule.days)
        .map((d) => RRULE_DAYS[d])
        .join(",")}`;
    case "monthly":
      return `FREQ=MONTHLY;BYMONTHDAY=${rule.day === "last" ? -1 : rule.day}`;
  }
}

/** Reads stored RRULE text back into a preset; null for anything outside the presets. */
export function parseRrule(rrule: string): RepeatRule | null {
  const parts = new Map<string, string>();
  for (const part of rrule.trim().toUpperCase().split(";")) {
    const [key, value, extra] = part.split("=");
    if (!key || value === undefined || extra !== undefined || parts.has(key)) return null;
    parts.set(key, value);
  }
  const freq = parts.get("FREQ");
  if (freq === "DAILY" && parts.size === 1) return { kind: "daily" };
  if (freq === "WEEKLY" && parts.size === 2 && parts.has("BYDAY")) {
    const codes = parts.get("BYDAY")!.split(",");
    const days = codes.map((code) => RRULE_DAYS.indexOf(code as (typeof RRULE_DAYS)[number]));
    if (days.some((d) => d < 0) || new Set(days).size !== days.length) return null;
    const weekdays = sortedDays(days as Weekday[]);
    const isWorkweek =
      weekdays.length === WORKWEEK.length && weekdays.every((d, i) => d === WORKWEEK[i]);
    return isWorkweek ? { kind: "weekdays" } : { kind: "weekly", days: weekdays };
  }
  if (freq === "MONTHLY" && parts.size === 2 && parts.has("BYMONTHDAY")) {
    const value = parts.get("BYMONTHDAY")!;
    if (value === "-1") return { kind: "monthly", day: "last" };
    if (!/^\d{1,2}$/.test(value)) return null;
    const day = Number(value);
    return day >= 1 && day <= 28 ? { kind: "monthly", day } : null;
  }
  return null;
}

/** Calendar arithmetic on `YYYY-MM-DD`, independent of any time zone. */
function localDateParts(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { day, weekday: date.getUTCDay() as Weekday, lastDay, time: date.getTime() };
}

function addDays(localDate: string, days: number): string {
  return new Date(localDateParts(localDate).time + days * DAY_MS).toISOString().slice(0, 10);
}

function matches(rule: RepeatRule, localDate: string): boolean {
  const { day, weekday, lastDay } = localDateParts(localDate);
  switch (rule.kind) {
    case "daily":
      return true;
    case "weekdays":
      return WORKWEEK.includes(weekday);
    case "weekly":
      return rule.days.includes(weekday);
    case "monthly":
      return rule.day === "last" ? day === lastDay : day === rule.day;
  }
}

/**
 * The first date matching `rule` at `timeOfDay` (`HH:mm`, company timezone) strictly after
 * `after`. Used for the first post of a series (from the chosen start) and for each next one.
 */
export function nextOccurrence(
  rule: RepeatRule,
  timeOfDay: string,
  after: Date,
  timeZone: string,
): Date {
  let localDate = formatInTimeZone(after, timeZone, "yyyy-MM-dd");
  // Monthly rules can be up to ~31 days apart; a little over a year covers every case.
  for (let i = 0; i < 400; i++, localDate = addDays(localDate, 1)) {
    if (!matches(rule, localDate)) continue;
    const candidate = zonedLocalToUtc(`${localDate}T${timeOfDay}`, timeZone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error("no occurrence within a year");
}

/** `HH:mm` of an instant in the company timezone, the time a series keeps. */
export function timeOfDayKey(date: Date | string, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "HH:mm");
}

function ordinal(n: number): string {
  const suffix =
    n % 10 === 1 && n !== 11
      ? "st"
      : n % 10 === 2 && n !== 12
        ? "nd"
        : n % 10 === 3 && n !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

function listDays(days: Weekday[]): string {
  const names = sortedDays(days).map((d) => DAY_NAMES[d]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** e.g. "Every weekday at 9:00 AM", "Monthly on the last day at 5:00 PM". */
export function describeRepeat(rule: RepeatRule, dueAt: Date | string, timeZone: string): string {
  const at = `at ${timeOfDayInTz(dueAt, timeZone)}`;
  switch (rule.kind) {
    case "daily":
      return `Every day ${at}`;
    case "weekdays":
      return `Every weekday ${at}`;
    case "weekly":
      return rule.days.length === 7 ? `Every day ${at}` : `Every ${listDays(rule.days)} ${at}`;
    case "monthly":
      return rule.day === "last"
        ? `Monthly on the last day ${at}`
        : `Monthly on the ${ordinal(rule.day)} ${at}`;
  }
}
