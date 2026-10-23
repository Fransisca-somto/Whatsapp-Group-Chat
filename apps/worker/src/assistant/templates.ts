// Fixed bot replies (api-interfaces.md §5.4). Same style as AI answers (ADR-029): one short,
// plain sentence. Code sends these; the AI never writes them.
import { chatTimeInTz, localDateInTz, timeOfDayInTz } from "@soft-agent-support/shared";

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
  /** P3: reminders by tag arrive in Phase 6. */
  remindersNotYet:
    "Setting reminders here isn't available yet. Please ask an admin to add it from the dashboard.",
} as const;

/**
 * Added under a scheduled post sent more than 2 minutes late (api-interfaces.md §5.4), e.g.
 * "(Sent late: this was scheduled for 9:00 AM.)", with the day when it was not today.
 */
export function lateNote(dueAt: Date, sentAt: Date, timeZone: string): string {
  const sameDay = localDateInTz(dueAt, timeZone) === localDateInTz(sentAt, timeZone);
  const when = sameDay ? timeOfDayInTz(dueAt, timeZone) : chatTimeInTz(dueAt, timeZone);
  return `(Sent late: this was scheduled for ${when}.)`;
}
