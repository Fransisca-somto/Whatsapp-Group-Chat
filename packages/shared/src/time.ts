// Company-timezone helpers (architecture.md §9). Every function takes the IANA timezone as an
// argument; nothing here reads the server's local time zone.
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

const LOCAL_DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const TIME_OF_DAY_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Display format for the dashboard, e.g. "Fri 9 Oct, 3:00 PM GMT+1". */
export function formatInCompanyTz(date: Date | string, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "EEE d MMM, h:mm a zzz");
}

/**
 * Interprets a wall-clock time in the company timezone and returns the UTC instant.
 * `localDateTime` is `YYYY-MM-DDTHH:mm` (seconds optional), the format the AI returns as `dueAtLocal`.
 */
export function zonedLocalToUtc(localDateTime: string, timeZone: string): Date {
  if (!LOCAL_DATE_TIME_REGEX.test(localDateTime)) {
    throw new Error(`Invalid local date-time "${localDateTime}"; expected YYYY-MM-DDTHH:mm`);
  }
  const result = fromZonedTime(localDateTime, timeZone);
  if (Number.isNaN(result.getTime())) {
    throw new Error(`Invalid local date-time "${localDateTime}" in time zone "${timeZone}"`);
  }
  return result;
}

/**
 * Returns a Date whose local fields (getHours, getDate, …) show the wall-clock time in `timeZone`.
 * Use only for reading calendar fields; never store or compare the result as an instant.
 */
export function utcToZoned(date: Date | string, timeZone: string): Date {
  return toZonedTime(date, timeZone);
}

/**
 * Next occurrence of `weekday` at `time` (`HH:mm`) in `timeZone`, strictly after `now`.
 * A weekday named on that same weekday after the time has passed means next week (architecture.md §9).
 */
export function nextWeekdayOccurrence(
  weekday: Weekday,
  time: string,
  timeZone: string,
  now: Date,
): Date {
  if (!TIME_OF_DAY_REGEX.test(time)) {
    throw new Error(`Invalid time "${time}"; expected HH:mm`);
  }
  const todayLocal = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  // ISO day of week: 1 = Monday … 7 = Sunday.
  const todayWeekday = Number(formatInTimeZone(now, timeZone, "i")) % 7;
  const daysAhead = (weekday - todayWeekday + 7) % 7;

  const candidate = zonedLocalToUtc(
    `${addDaysToLocalDate(todayLocal, daysAhead)}T${time}`,
    timeZone,
  );
  if (candidate.getTime() > now.getTime()) {
    return candidate;
  }
  return zonedLocalToUtc(`${addDaysToLocalDate(todayLocal, daysAhead + 7)}T${time}`, timeZone);
}

// Calendar arithmetic on a `YYYY-MM-DD` string, independent of any time zone.
function addDaysToLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid local date "${localDate}"`);
  }
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}
