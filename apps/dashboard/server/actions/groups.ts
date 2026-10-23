"use server";

// Group actions for owner and staff (api-interfaces.md §3). Status changes follow the shared
// transition rules in packages/shared/src/groups.ts; the worker picks changes up within 30 s.
import {
  changeGroupStatusInputSchema,
  groupActionTarget,
  loadGroupMessagesInputSchema,
  updateGroupSettingsInputSchema,
  type GroupAction,
  type GroupStatus,
} from "@soft-agent-support/shared";
import { revalidatePath } from "next/cache";

import { GROUP_MESSAGE_COLUMNS, GROUP_MESSAGES_PAGE, type GroupMessageView } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";
import { auditDashboardAction } from "@/server/audit";
import { getAccessDecision } from "@/server/currentUser";

import type { ActionResult } from "./connection";

const AUDIT_ACTION: Record<GroupAction, string> = {
  approve: "group_approved",
  pause: "group_paused",
  resume: "group_resumed",
  archive: "group_archived",
};

async function requireDashboardUser() {
  const access = await getAccessDecision();
  return access.kind === "allowed" ? access : null;
}

async function audit(input: Parameters<typeof auditDashboardAction>[0]) {
  try {
    await auditDashboardAction(input);
  } catch (error) {
    // The change itself succeeded; a missing audit row must not undo it.
    console.error("group action: audit write failed", error);
  }
}

function refresh(groupId: string) {
  revalidatePath("/groups");
  revalidatePath(`/groups/${groupId}`);
}

export async function changeGroupStatus(
  input: unknown,
): Promise<ActionResult<{ status: GroupStatus }>> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: "You need dashboard access to change groups." };

  const parsed = changeGroupStatusInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown group or action." };
  const { groupId, action } = parsed.data;

  const supabase = await createClient();
  const { data: group, error: readError } = await supabase
    .from("groups")
    .select("id, name, status")
    .eq("id", groupId)
    .maybeSingle();
  if (readError) {
    console.error("changeGroupStatus: read failed", readError);
    return { ok: false, error: "Could not load the group. Please try again." };
  }
  if (!group) return { ok: false, error: "That group no longer exists." };

  const current = group.status as GroupStatus;
  const target = groupActionTarget(current, action);
  if (!target) {
    return { ok: false, error: `You can't ${action} a group that is ${current}.` };
  }

  const { data: updated, error } = await supabase
    .from("groups")
    .update({
      status: target,
      ...(action === "approve"
        ? { approved_by: user.userId, approved_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", groupId)
    .eq("status", current) // only if nobody changed it meanwhile
    .select("id");
  if (error) {
    console.error("changeGroupStatus: update failed", error);
    return { ok: false, error: "Could not update the group. Please try again." };
  }
  if (updated.length === 0) {
    return { ok: false, error: "The group changed while you were looking. Refresh and try again." };
  }

  await audit({
    userId: user.userId,
    action: AUDIT_ACTION[action],
    groupId,
    detail: { name: group.name, from: current, to: target },
  });
  refresh(groupId);
  return { ok: true, data: { status: target } };
}

export async function updateGroupSettings(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: "You need dashboard access to change groups." };

  const parsed = updateGroupSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the settings." };
  }
  const {
    groupId,
    reminderPermission,
    aiEnabled,
    allowGeneralKnowledge,
    dailyReplyCap,
    retentionDays,
  } = parsed.data;

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("groups")
    .update({
      reminder_permission: reminderPermission,
      ai_enabled: aiEnabled,
      allow_general_knowledge: allowGeneralKnowledge,
      daily_reply_cap: dailyReplyCap,
      retention_days: retentionDays,
    })
    .eq("id", groupId)
    .select("id");
  if (error) {
    console.error("updateGroupSettings: update failed", error);
    return { ok: false, error: "Could not save the settings. Please try again." };
  }
  if (updated.length === 0) return { ok: false, error: "That group no longer exists." };

  await audit({
    userId: user.userId,
    action: "group_settings_updated",
    groupId,
    detail: { reminderPermission, aiEnabled, allowGeneralKnowledge, dailyReplyCap, retentionDays },
  });
  refresh(groupId);
  return { ok: true, data: undefined };
}

export async function loadOlderGroupMessages(
  input: unknown,
): Promise<ActionResult<GroupMessageView[]>> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: "You need dashboard access to read messages." };

  const parsed = loadGroupMessagesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not load older messages." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_messages")
    .select(GROUP_MESSAGE_COLUMNS)
    .eq("group_id", parsed.data.groupId)
    .lt("sent_at", parsed.data.before)
    .order("sent_at", { ascending: false })
    .limit(GROUP_MESSAGES_PAGE);
  if (error) {
    console.error("loadOlderGroupMessages: read failed", error);
    return { ok: false, error: "Could not load older messages. Please try again." };
  }
  return { ok: true, data };
}
