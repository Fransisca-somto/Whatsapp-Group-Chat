// Fixed bot replies (api-interfaces.md §5.4). Same style as AI answers (ADR-029): one short,
// plain sentence. Code sends these; the AI never writes them.

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
