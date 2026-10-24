// Who may create a reminder by tagging the bot (api-interfaces.md §5.3, ADR-006, ADR-013).
// Decided by code from the group's setting and the dashboard's list, never by the AI.
import type { ReminderPermission } from "@soft-agent-support/shared";

/** An active authorized user, as the worker reads them. */
export type AuthorizedUser = {
  phoneE164: string;
  allGroups: boolean;
  /** The groups they may use when `allGroups` is false. */
  groupIds: string[];
};

export type PermissionDecision = "allowed" | "not_authorized" | "no_phone";

export function canCreateReminder(input: {
  permission: ReminderPermission;
  groupId: string;
  /** null when WhatsApp hides the sender's number. */
  senderPhone: string | null;
  authorizedUsers: AuthorizedUser[];
}): PermissionDecision {
  if (input.permission === "any_member") return "allowed";
  if (!input.senderPhone) return "no_phone";
  const listed = input.authorizedUsers.some(
    (user) =>
      user.phoneE164 === input.senderPhone &&
      (user.allGroups || user.groupIds.includes(input.groupId)),
  );
  return listed ? "allowed" : "not_authorized";
}
