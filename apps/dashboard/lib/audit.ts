// Labels and one-line summaries for the audit log (ui-context.md §4 `/audit`). bot_actions.detail
// is free-form JSON, so every read here is defensive: unknown shapes fall back to "".
import { formatPhoneForDisplay, type Json } from "@soft-agent-support/shared";

export const AUDIT_PAGE = 50;

export const AUDIT_COLUMNS =
  "id, created_at, action, actor_type, actor_ref, group_id, detail, groups(name)";

export type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  actor_type: string;
  actor_ref: string | null;
  group_id: string | null;
  detail: Json;
  groups: { name: string } | null;
};

/** Every action the worker and dashboard write, in the order the filter lists them. */
export const ACTION_LABELS: Record<string, string> = {
  answered: "Answered",
  refused: "Refused",
  rate_limited: "Rate limited",
  ai_failed: "AI failed",
  send_failed: "Reply not sent",
  not_set_up: "Not set up",
  skipped_stale: "Skipped (too old)",
  group_detected: "Group detected",
  group_approved: "Group approved",
  group_paused: "Group paused",
  group_resumed: "Group resumed",
  group_archived: "Group archived",
  group_removed: "Bot removed from group",
  group_readded: "Bot re-added to group",
  group_renamed: "Group renamed",
  group_settings_updated: "Group settings changed",
  training_added: "Training added",
  training_updated: "Training changed",
  training_deleted: "Training deleted",
  training_imported: "Training uploaded",
  training_copied: "Training copied",
  bot_instructions_updated: "Bot instructions changed",
  company_settings_updated: "Company settings changed",
  ai_key_saved: "AI key saved",
  ai_key_removed: "AI key removed",
  ai_models_updated: "AI models changed",
  pairing_requested: "Link requested",
  relink_requested: "Relink requested",
  messages_purged: "Old messages deleted",
  post_created: "Post scheduled",
  post_updated: "Post changed",
  post_cancelled: "Post cancelled",
  post_resent: "Post resent",
  post_dismissed: "Post dismissed",
  post_sent: "Post sent",
  post_failed: "Post failed",
  post_uncertain: "Delivery uncertain",
  post_skipped_late: "Post skipped (late)",
  reminder_requested: "Reminder requested",
  reminder_confirmed: "Reminder confirmed",
  reminder_declined: "Reminder cancelled",
  reminder_expired: "Reminder request expired",
  reminder_unclear: "Reminder not understood",
  reminder_late_reply: "Reply after request expired",
  refused_unauthorized: "Reminder refused",
  authorized_user_added: "Authorized user added",
  authorized_user_updated: "Authorized user changed",
  authorized_user_deleted: "Authorized user removed",
  attachment_deleted: "Unused attachment deleted",
  relink_started: "Number change started",
  group_readmitted: "Group back after number change",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

function field(detail: Json, key: string): Json | undefined {
  return detail && typeof detail === "object" && !Array.isArray(detail) ? detail[key] : undefined;
}

function text(value: Json | undefined): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

const REASONS: Record<string, string> = {
  injection: "tried to change the rules",
  abusive: "abusive",
  off_topic: "off topic",
  reminders_not_available: "reminder (not available yet)",
  edit_reminder: "edit a reminder (dashboard only)",
  cancel_reminder: "cancel a reminder (dashboard only)",
  recurring_reminder: "repeating reminder (dashboard only)",
  announcement: "announcement (dashboard only)",
  no_ai_settings: "no AI key or model saved",
  no_training: "group has no training",
  settings_unavailable: "settings could not be read",
  no_credits: "no OpenRouter credit",
  invalid_key: "OpenRouter key rejected",
  timeout: "AI took too long",
  unavailable: "AI service down",
  rate_limited: "OpenRouter rate limit",
  not_authorized: "not on the authorized list",
  no_phone: "number not visible",
  unclear_time: "time not clear",
  too_soon: "time too soon",
  too_far: "more than a year ahead",
  bad_text: "text empty or too long",
};

/** "found 3 older messages" when search added history to an answer (Phase 4), else null. */
function historyText(detail: Json): string | null {
  const count = Number(field(detail, "historyMatches")) || 0;
  if (count <= 0) return null;
  return `found ${count} older ${count === 1 ? "message" : "messages"}`;
}

/** A short, human summary of what happened, e.g. "answered · found 3 older messages · 412 tokens". */
export function auditSummary(row: Pick<AuditRow, "action" | "detail">): string {
  const d = row.detail;
  const reason = text(field(d, "reason")) ?? text(field(d, "failure"));
  const readableReason = reason ? (REASONS[reason] ?? reason.replace(/_/g, " ")) : null;
  const tokens = (Number(field(d, "inputTokens")) || 0) + (Number(field(d, "outputTokens")) || 0);
  const tokenText = tokens > 0 ? `${tokens.toLocaleString("en")} tokens` : null;

  switch (row.action) {
    case "answered": {
      const kind = text(field(d, "kind"));
      const what =
        kind === "dont_know" ? "didn't know" : kind === "smalltalk" ? "small talk" : "answered";
      return [what, historyText(d), tokenText].filter(Boolean).join(" · ");
    }
    case "refused":
    case "not_set_up":
    case "ai_failed":
      return [readableReason, tokenText].filter(Boolean).join(" · ");
    case "rate_limited":
      return text(field(d, "scope")) === "group"
        ? "daily limit reached"
        : "too many tags in a minute";
    case "skipped_stale": {
      const age = Number(field(d, "ageSeconds"));
      return Number.isFinite(age) ? `${Math.round(age / 60)} min old` : "";
    }
    case "group_approved":
    case "group_paused":
    case "group_resumed":
    case "group_archived": {
      const from = text(field(d, "from"));
      const to = text(field(d, "to"));
      return from && to ? `${from} → ${to}` : "";
    }
    case "group_renamed":
      return text(field(d, "previousName")) ? `was “${text(field(d, "previousName"))}”` : "";
    case "training_added":
    case "training_updated":
    case "training_deleted":
      return text(field(d, "title")) ?? "";
    case "training_imported":
    case "training_copied": {
      const count = text(field(d, "count"));
      return count ? `${count} ${count === "1" ? "entry" : "entries"}` : "";
    }
    case "messages_purged": {
      const count = Number(field(d, "count")) || 0;
      const days = text(field(d, "retentionDays"));
      const what = `${count.toLocaleString("en")} ${count === 1 ? "message" : "messages"}`;
      return days ? `${what} older than ${days} days` : what;
    }
    case "relink_started": {
      const count = Number(field(d, "groups")) || 0;
      return `${count} ${count === 1 ? "group" : "groups"} to re-add`;
    }
    case "group_readmitted":
      return text(field(d, "status")) ? `back to ${text(field(d, "status"))}` : "";
    case "attachment_deleted":
      return text(field(d, "kind")) ?? "";
    case "post_created":
    case "post_updated":
    case "post_resent":
    case "post_dismissed":
    case "post_skipped_late":
      return text(field(d, "kind")) ?? "";
    case "post_cancelled":
      return [text(field(d, "kind")), field(d, "endedSeries") === true ? "series ended" : null]
        .filter(Boolean)
        .join(" · ");
    case "post_sent":
      return [text(field(d, "kind")), field(d, "late") === true ? "sent late" : null]
        .filter(Boolean)
        .join(" · ");
    case "post_failed":
    case "post_uncertain":
      return [text(field(d, "kind")), text(field(d, "error")) ?? text(field(d, "reason"))]
        .filter(Boolean)
        .join(" · ");
    case "authorized_user_added":
    case "authorized_user_updated":
    case "authorized_user_deleted":
      return text(field(d, "name")) ?? "";
    case "reminder_requested":
    case "reminder_confirmed":
      return text(field(d, "dueAt")) ? `due ${text(field(d, "dueAt"))}` : "";
    case "ai_key_saved":
      return text(field(d, "hint")) ? `ends in …${text(field(d, "hint"))}` : "";
    case "ai_models_updated":
      return [text(field(d, "chatModel")), text(field(d, "fallbackModel"))]
        .filter(Boolean)
        .join(", fallback ");
    default:
      return readableReason ?? "";
  }
}

/** Who did it: a dashboard user's name, a member's phone, or "System". */
export function auditActor(
  row: Pick<AuditRow, "actor_type" | "actor_ref">,
  dashboardNames: Record<string, string>,
): string {
  if (row.actor_type === "system") return "System";
  if (row.actor_type === "dashboard_user") {
    return (row.actor_ref && dashboardNames[row.actor_ref]) || "Dashboard user";
  }
  if (row.actor_ref?.startsWith("+")) return formatPhoneForDisplay(row.actor_ref);
  return "Group member";
}
