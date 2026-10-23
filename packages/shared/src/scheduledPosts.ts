// Rules shared by the dashboard (preview, validation) and the worker (sending) for reminders and
// announcements (Workflow/Phases/07-Scheduler.md, ADR-033).
import { nextOccurrence, timeOfDayKey, type RepeatRule } from "./recurrence.ts";
import type { ScheduledPostKind, ScheduledPostStatus } from "./schemas/enums.ts";
import { zonedLocalToUtc } from "./time.ts";

const MINUTE_MS = 60_000;
const YEAR_MS = 365 * 24 * 60 * MINUTE_MS;

/** Posts that went wrong and wait for an admin (P18). */
export const ATTENTION_STATUSES = [
  "failed",
  "delivery_uncertain",
  "skipped_late",
] as const satisfies readonly ScheduledPostStatus[];

/** P15: what the group sees. A reminder is labelled; an announcement goes out as written. */
export function formatScheduledPost(kind: ScheduledPostKind, body: string): string {
  const text = body.trim();
  return kind === "reminder" ? `*Reminder:* ${text}` : text;
}

/**
 * The UTC time of a new or edited post (P16). A repeating post starts on the first matching day
 * at or after the chosen date and time. Returns an error message the form can show instead.
 */
export function resolveDueAt(
  input: { dueAtLocal: string; repeat: RepeatRule | null },
  timeZone: string,
  now: Date,
): { ok: true; dueAt: Date } | { ok: false; error: string } {
  let chosen: Date;
  try {
    chosen = zonedLocalToUtc(input.dueAtLocal, timeZone);
  } catch {
    return { ok: false, error: "Pick a valid date and time." };
  }
  const dueAt = input.repeat
    ? nextOccurrence(
        input.repeat,
        timeOfDayKey(chosen, timeZone),
        new Date(chosen.getTime() - 1),
        timeZone,
      )
    : chosen;
  if (dueAt.getTime() < now.getTime() + MINUTE_MS) {
    return { ok: false, error: "Pick a time at least a minute from now." };
  }
  if (dueAt.getTime() > now.getTime() + YEAR_MS) {
    return { ok: false, error: "Pick a time within the next year." };
  }
  return { ok: true, dueAt };
}
