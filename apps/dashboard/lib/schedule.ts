// Shapes and labels for reminders and announcements (ui-context.md §4 `/schedule`).
import {
  attachmentKindSchema,
  describeRepeat,
  formatPhoneForDisplay,
  localDateTimeInTz,
  parseRrule,
  type Attachment,
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
  "id, group_id, kind, body, due_at, recurrence_rule, status, sent_at, sent_late, last_error, dismissed_at, created_via, created_by_phone_e164, attachment_path, attachment_kind, attachment_mime, attachment_name, attachment_size, attachment_seconds, attachment_deleted_at, groups(name)";

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
  /** One attachment (Phase 6, 6.6); all null when there is none. */
  attachment_path: string | null;
  attachment_kind: string | null;
  attachment_mime: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  attachment_seconds: number | null;
  /** The file was removed by the cleanup job; the details stay for history. */
  attachment_deleted_at: string | null;
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

/** "Voice note (0:42)", or the file's name. */
export function attachmentLabel(attachment: Pick<Attachment, "kind" | "name" | "seconds">): string {
  if (attachment.kind === "voice" && attachment.seconds) {
    const m = Math.floor(attachment.seconds / 60);
    const s = String(attachment.seconds % 60).padStart(2, "0");
    return `Voice note (${m}:${s})`;
  }
  return attachment.name;
}

/** The stored attachment as the form and lists use it, or null. */
export function attachmentFromPost(
  post: Pick<
    ScheduledPostView,
    | "attachment_path"
    | "attachment_kind"
    | "attachment_mime"
    | "attachment_name"
    | "attachment_size"
    | "attachment_seconds"
  >,
): Attachment | null {
  const kind = attachmentKindSchema.safeParse(post.attachment_kind);
  if (!post.attachment_path || !kind.success) return null;
  return {
    path: post.attachment_path,
    kind: kind.data,
    mime: post.attachment_mime ?? "",
    name: post.attachment_name ?? "file",
    size: post.attachment_size ?? 1,
    seconds: post.attachment_seconds,
  };
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
  post: ScheduledPostView,
  timeZone: string,
): {
  groupId: string;
  kind: ScheduledPostKind;
  body: string;
  dueAtLocal: string;
  repeat: RepeatRule | null;
  attachment: Attachment | null;
} {
  return {
    groupId: post.group_id,
    kind: post.kind as ScheduledPostKind,
    body: post.body,
    dueAtLocal: localDateTimeInTz(post.due_at, timeZone),
    repeat: post.recurrence_rule ? parseRrule(post.recurrence_rule) : null,
    attachment: post.attachment_deleted_at ? null : attachmentFromPost(post),
  };
}
