"use server";

// Authorized users for owner and staff (api-interfaces.md §3, ADR-006, Workflow/Phases/
// 08-Tag-Reminders.md 6.1). In "admins only" groups, only these numbers may create reminders by
// tagging the bot; the worker reads the list fresh for each request.
import {
  authorizedUserIdInputSchema,
  setAuthorizedUserActiveInputSchema,
  upsertAuthorizedUserInputSchema,
} from "@soft-agent-support/shared";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { auditDashboardAction } from "@/server/audit";
import { getAccessDecision } from "@/server/currentUser";

import type { ActionResult } from "./connection";

const NO_ACCESS = "You need dashboard access to manage authorized users.";
const UNIQUE_VIOLATION = "23505";

async function requireDashboardUser() {
  const access = await getAccessDecision();
  return access.kind === "allowed" ? access : null;
}

async function audit(input: Parameters<typeof auditDashboardAction>[0]) {
  try {
    await auditDashboardAction(input);
  } catch (error) {
    // The change itself succeeded; a missing audit row must not undo it.
    console.error("authorized user action: audit write failed", error);
  }
}

function firstIssue(error: { issues: { message: string }[] }, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

export async function upsertAuthorizedUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = upsertAuthorizedUserInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Check the details.") };
  const { id, displayName, phoneE164, allGroups, groupIds, isActive } = parsed.data;

  const supabase = await createClient();
  const values = {
    display_name: displayName,
    phone_e164: phoneE164,
    all_groups: allGroups,
    is_active: isActive,
  };
  const { data, error } = id
    ? await supabase.from("authorized_users").update(values).eq("id", id).select("id")
    : await supabase.from("authorized_users").insert(values).select("id");
  if (error?.code === UNIQUE_VIOLATION) {
    return { ok: false, error: "This number is already on the list." };
  }
  if (error) {
    console.error("upsertAuthorizedUser: write failed", error);
    return { ok: false, error: "Could not save. Please try again." };
  }
  const saved = data[0];
  if (!saved) return { ok: false, error: "That person is no longer on the list." };

  // Replace the group links: none when they may use every group.
  const { error: clearError } = await supabase
    .from("authorized_user_groups")
    .delete()
    .eq("authorized_user_id", saved.id);
  const links = allGroups ? [] : [...new Set(groupIds)];
  const { error: linkError } =
    links.length > 0
      ? await supabase
          .from("authorized_user_groups")
          .insert(links.map((groupId) => ({ authorized_user_id: saved.id, group_id: groupId })))
      : { error: null };
  if (clearError || linkError) {
    console.error("upsertAuthorizedUser: group links failed", clearError ?? linkError);
    return { ok: false, error: "Saved, but the groups could not be updated. Please try again." };
  }

  await audit({
    userId: user.userId,
    action: id ? "authorized_user_updated" : "authorized_user_added",
    detail: {
      authorizedUserId: saved.id,
      name: displayName,
      allGroups,
      groupCount: links.length,
      isActive,
    },
  });
  revalidatePath("/authorized-users");
  return { ok: true, data: { id: saved.id } };
}

export async function setAuthorizedUserActive(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = setAuthorizedUserActiveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown person." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("authorized_users")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.id)
    .select("id, display_name");
  if (error) {
    console.error("setAuthorizedUserActive: update failed", error);
    return { ok: false, error: "Could not update. Please try again." };
  }
  const row = data[0];
  if (!row) return { ok: false, error: "That person is no longer on the list." };

  await audit({
    userId: user.userId,
    action: "authorized_user_updated",
    detail: { authorizedUserId: row.id, name: row.display_name, isActive: parsed.data.isActive },
  });
  revalidatePath("/authorized-users");
  return { ok: true, data: undefined };
}

export async function deleteAuthorizedUser(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = authorizedUserIdInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown person." };

  const supabase = await createClient();
  // Group links go with it (on delete cascade).
  const { data, error } = await supabase
    .from("authorized_users")
    .delete()
    .eq("id", parsed.data.id)
    .select("id, display_name");
  if (error) {
    console.error("deleteAuthorizedUser: delete failed", error);
    return { ok: false, error: "Could not remove. Please try again." };
  }
  const row = data[0];
  if (!row) return { ok: false, error: "That person was already removed." };

  await audit({
    userId: user.userId,
    action: "authorized_user_deleted",
    detail: { authorizedUserId: row.id, name: row.display_name },
  });
  revalidatePath("/authorized-users");
  return { ok: true, data: undefined };
}
