// Reminders created by tagging the bot (Workflow/Phases/08-Tag-Reminders.md, ADR-035). The AI
// only reads the request; these rules decide what counts as a confirmation and whether a draft
// can be saved.
import { formatInTimeZone } from "date-fns-tz";

import { zonedLocalToUtc } from "./time.ts";

/** P24 and the spec: text limit, earliest and latest time, confirmation window. */
export const REMINDER_BODY_MAX = 500;
export const REMINDER_MIN_LEAD_MS = 3 * 60_000;
export const REMINDER_MAX_LEAD_MS = 365 * 24 * 60 * 60_000;
export const REMINDER_CONFIRM_MS = 2 * 60_000;
/** P23: a "yes" this long after a request expired gets the "expired" reply. */
export const REMINDER_LATE_REPLY_MS = 10 * 60_000;

/** P21: the whole message must be one of these words. */
export const YES_WORDS = ["yes", "y", "confirm", "ok", "okay", "yeah", "yep"] as const;
export const NO_WORDS = ["no", "n", "cancel", "stop"] as const;

/**
 * "yes" / "no" if the message is only a confirmation word (any case, @mentions, spaces and
 * surrounding punctuation ignored), else null. "yes please" or "yes, 4pm" is not a confirmation.
 */
export function replyWord(text: string | null | undefined): "yes" | "no" | null {
  if (!text) return null;
  const word = text
    .replace(/@\S+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^[\s.,;:!?'"()]+|[\s.,;:!?'"()]+$/g, "");
  if ((YES_WORDS as readonly string[]).includes(word)) return "yes";
  if ((NO_WORDS as readonly string[]).includes(word)) return "no";
  return null;
}

export type ReminderDraft = {
  body: string;
  /** `YYYY-MM-DDTHH:mm` in the company timezone, as the AI read it. */
  dueAtLocal: string;
  confidence: "high" | "low";
};

export type DraftCheck =
  | { ok: true; body: string; dueAt: Date }
  | { ok: false; reason: "unclear_time" | "too_soon" | "too_far" | "bad_text" };

/** Code's check of the AI's reading (ADR-013): a clear time 3 minutes to 1 year ahead, 1–500 chars. */
export function checkReminderDraft(draft: ReminderDraft, timeZone: string, now: Date): DraftCheck {
  if (draft.confidence !== "high") return { ok: false, reason: "unclear_time" };
  const body = draft.body.trim();
  if (body.length === 0 || body.length > REMINDER_BODY_MAX)
    return { ok: false, reason: "bad_text" };
  let dueAt: Date;
  try {
    dueAt = zonedLocalToUtc(draft.dueAtLocal, timeZone);
  } catch {
    return { ok: false, reason: "unclear_time" };
  }
  const lead = dueAt.getTime() - now.getTime();
  if (lead < REMINDER_MIN_LEAD_MS) return { ok: false, reason: "too_soon" };
  if (lead > REMINDER_MAX_LEAD_MS) return { ok: false, reason: "too_far" };
  return { ok: true, body, dueAt };
}

/** "Friday 30 Oct at 3:00 PM GMT+1": the full day, date, time and zone, so a misread is obvious. */
export function reminderTimeInTz(date: Date | string, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "EEEE d MMM 'at' h:mm a zzz");
}
