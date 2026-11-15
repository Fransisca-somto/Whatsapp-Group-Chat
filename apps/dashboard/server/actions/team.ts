"use server";

// Owner-only Team actions (ADR-039): add staff to the owner's own tenant and remove them. Staff
// manage content but cannot open Connection, Settings or Team. Creating and deleting logins needs
// the service-role client; every query is limited to the owner's tenant.
import { createStaffInputSchema, removeStaffInputSchema } from "@soft-agent-support/shared";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createLogin, deleteLogin } from "@/server/accounts";
import { auditDashboardAction } from "@/server/audit";
import { getAccessDecision } from "@/server/currentUser";

import type { ActionResult } from "./connection";

const OWNER_ONLY = "Only the owner can manage the team.";

async function requireOwner() {
  const access = await getAccessDecision();
  return access.kind === "allowed" && access.role === "owner" ? access : null;
}

async function audit(input: Parameters<typeof auditDashboardAction>[0]) {
  try {
    await auditDashboardAction(input);
  } catch (error) {
    // The change itself succeeded; a missing audit row must not undo it.
    console.error("team action: audit write failed", error);
  }
}

export async function addStaff(input: unknown): Promise<ActionResult<{ userId: string }>> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };

  const parsed = createStaffInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  }
  const { displayName, email, temporaryPassword } = parsed.data;

  const service = createAdminClient();
  const login = await createLogin(service, email, temporaryPassword);
  if (!login.ok) return login;

  const { error } = await service.from("dashboard_users").insert({
    user_id: login.userId,
    tenant_id: owner.tenantId,
    display_name: displayName,
    role: "staff",
  });
  if (error) {
    console.error("addStaff: insert failed", error);
    await deleteLogin(service, login.userId);
    return { ok: false, error: "Could not add them. Please try again." };
  }

  await audit({
    userId: owner.userId,
    tenantId: owner.tenantId,
    action: "staff_added",
    detail: { staffUserId: login.userId, name: displayName, email },
  });
  revalidatePath("/team");
  return { ok: true, data: { userId: login.userId } };
}

export async function removeStaff(input: unknown): Promise<ActionResult> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };

  const parsed = removeStaffInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown team member." };
  const { userId } = parsed.data;

  const service = createAdminClient();
  // Only staff of this owner's own tenant: never the owner, never another company's people.
  const { data: member, error } = await service
    .from("dashboard_users")
    .select("display_name")
    .eq("user_id", userId)
    .eq("tenant_id", owner.tenantId)
    .eq("role", "staff")
    .maybeSingle();
  if (error) {
    console.error("removeStaff: read failed", error);
    return { ok: false, error: "Could not remove them. Please try again." };
  }
  if (!member) return { ok: false, error: "That person is not on your team." };

  if (!(await deleteLogin(service, userId))) {
    return { ok: false, error: "Could not remove them. Please try again." };
  }

  await audit({
    userId: owner.userId,
    tenantId: owner.tenantId,
    action: "staff_removed",
    detail: { staffUserId: userId, name: member.display_name },
  });
  revalidatePath("/team");
  return { ok: true, data: undefined };
}
