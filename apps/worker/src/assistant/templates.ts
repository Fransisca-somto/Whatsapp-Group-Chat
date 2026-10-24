// Fixed bot replies (api-interfaces.md §5.4). Same style as AI answers (ADR-029): one short,
// plain sentence. Code sends these; the AI never writes them.
import {
  chatTimeInTz,
  localDateInTz,
  reminderTimeInTz,
  timeOfDayInTz,
} from "@soft-agent-support/shared";

export const TEMPLATES = {
  /** P5: the answer is not in the group's training or recent chat. */
  dontKnow: "I don't have that information. Please check with your team lead.",
  /** No OpenRouter key or chat model saved on the Settings page yet. */
  notConfigured: "I'm not set up yet. Please ask an admin.",
  /** The group has no active training yet (ADR-026). */
  notTrained: "I haven't been set up for this group yet. Please ask an admin.",
  rateLimited: "I'm getting a lot of requests. Please try again in a minute.",
  dailyLimit: "I've reached my reply limit for today in this group. Please try again tomorrow.",
  aiUnavailable: "Sorry, I can't answer right now. Please try again shortly.",
  refuse: "Sorry, I can't help with that here.",
  dashboardOnly: "That can only be done from the dashboard. Please ask an admin.",
  /** Phase 6: the sender is not on the authorized-user list for this group. */
  notAuthorized: "Sorry, only authorized team members can set reminders here.",
  /** Phase 6: WhatsApp hides the sender's number, so the list can't be checked. */
  noPhone:
    "I can't see your number, so I can't check whether you can set reminders here. Please ask an admin.",
  unclearTime:
    'I couldn\'t work out the exact day and time. Could you say it again, e.g. "Friday 3pm"?',
  tooSoon: "That's too soon to set. Pick a time at least a few minutes from now.",
  tooFar: "I can only set reminders up to a year ahead.",
  badText: "Please keep the reminder short: what should I remind the group about?",
  reminderCancelled: "Okay, cancelled.",
  /** P23: a "yes" or "no" shortly after the request expired. */
  requestExpired: "That request has expired, so nothing was set. Tag me again to set it.",
} as const;

/** Repeats back exactly what will be saved (api-interfaces.md §5.4). */
export function confirmReminder(body: string, dueAt: Date, timeZone: string): string {
  const text = body.trim().replace(/[.!]+$/, "");
  return `Reminder for ${reminderTimeInTz(dueAt, timeZone)}: ${text}. Reply *yes* to confirm or *no* to cancel.`;
}

export function reminderSet(dueAt: Date, timeZone: string): string {
  return `Done. Reminder set for ${reminderTimeInTz(dueAt, timeZone)}.`;
}

/**
 * Added under a scheduled post sent more than 2 minutes late (api-interfaces.md §5.4), e.g.
 * "(Sent late: this was scheduled for 9:00 AM.)", with the day when it was not today.
 */
export function lateNote(dueAt: Date, sentAt: Date, timeZone: string): string {
  const sameDay = localDateInTz(dueAt, timeZone) === localDateInTz(sentAt, timeZone);
  const when = sameDay ? timeOfDayInTz(dueAt, timeZone) : chatTimeInTz(dueAt, timeZone);
  return `(Sent late: this was scheduled for ${when}.)`;
}
