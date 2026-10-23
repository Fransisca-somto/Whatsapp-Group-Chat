// Shapes and labels for reminders and announcements (ui-context.md §4 `/schedule`).
import {
  describeRepeat,
  formatPhoneForDisplay,
  localDateTimeInTz,
  parseRrule,
  type RepeatRule,
  type ScheduledPostKind,
  type ScheduledPostStatus,
} from "@soft-agent-support/shared";

export const SCHEDULE_TABS = ["upcoming", "attention", "history"] as const;
export type ScheduleTab = (typeof SCHEDULE_TABS)[number];

export const SCHEDULE_TAB_LABELS: Record<ScheduleTab, string> = {
  upcoming: "Upcoming",
  attention: "Needs attention",
  history: "History",
};

/** Rows per list; the oldest history beyond this is in the Audit log. */
export const SCHEDULE_LIST_LIMIT = 100;

export const SCHEDULED_POST_COLUMNS =
  "id, group_id, kind, body, due_at, recurrence_rule, status, sent_at, sent_late, last_error, dismissed_at, created_via, created_by_phone_e164, groups(name)";

export type ScheduledPostView = {
  id: string;
  group_id: string;
  kind: string;
  body: string;
  due_at: string;
  recurrence_rule: string | null;
  status: string;
  sent_at: string | null;
  sent_late: boolean;
  last_error: string | null;
  dismissed_at: string | null;
  /** `group`: set by tagging the bot (Phase 6). */
  created_via: string;
  created_by_phone_e164: string | null;
  groups: { name: string } | null;
};

/** A group the form can post to (active or paused, P16). */
export type SchedulableGroup = { id: string; name: string; status: string };

export const KIND_LABELS: Record<ScheduledPostKind, string> = {
  announcement: "Announcement",
  reminder: "Reminder",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as ScheduledPostKind] ?? kind;
}

/** "Every weekday at 9:00 AM", or null for a one-off post (or a rule we don't recognise). */
export function repeatLabel(
  post: Pick<ScheduledPostView, "recurrence_rule" | "due_at">,
  timeZone: string,
) {
  const rule = post.recurrence_rule ? parseRrule(post.recurrence_rule) : null;
  return rule ? describeRepeat(rule, post.due_at, timeZone) : null;
}

/** P26: "Set in the group by +234 801 234 5678" for a reminder set by tagging the bot. */
export function createdInGroupLabel(
  post: Pick<ScheduledPostView, "created_via" | "created_by_phone_e164">,
): string | null {
  if (post.created_via !== "group") return null;
  return post.created_by_phone_e164
    ? `Set in the group by ${formatPhoneForDisplay(post.created_by_phone_e164)}`
    : "Set in the group";
}

/** P18: why a post is in Needs attention, in plain words. */
export function attentionReason(post: Pick<ScheduledPostView, "status" | "last_error">): string {
  switch (post.status as ScheduledPostStatus) {
    case "delivery_uncertain":
      return "It may or may not have reached the group. Check the group before resending.";
    case "skipped_late":
      return "Not sent: the bot was offline for more than 2 hours after it was due.";
    case "failed":
      return post.last_error
        ? `WhatsApp didn't accept it (${post.last_error}).`
        : "WhatsApp didn't accept it.";
    default:
      return "";
  }
}

/** The form's starting values when editing an existing post. */
export function formValuesFromPost(
  post: Pick<ScheduledPostView, "group_id" | "kind" | "body" | "due_at" | "recurrence_rule">,
  timeZone: string,
): {
  groupId: string;
  kind: ScheduledPostKind;
  body: string;
  dueAtLocal: string;
  repeat: RepeatRule | null;
} {
  return {
    groupId: post.group_id,
    kind: post.kind as ScheduledPostKind,
    body: post.body,
    dueAtLocal: localDateTimeInTz(post.due_at, timeZone),
    repeat: post.recurrence_rule ? parseRrule(post.recurrence_rule) : null,
  };
}
