"use server";

// Platform admin actions (ADR-039): create an owner together with their new tenant, and suspend
// or reactivate a tenant. Only platform admins (public.platform_admins) may call these. The
// service-role client is needed to create logins and to write tenants.
import { createOwnerInputSchema, setTenantStatusInputSchema } from "@soft-agent-support/shared";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createLogin, deleteLogin } from "@/server/accounts";
import { auditDashboardAction } from "@/server/audit";
import { getAccessDecision } from "@/server/currentUser";

import type { ActionResult } from "./connection";

const ADMIN_ONLY = "Only the platform admin can manage companies.";

async function requirePlatformAdmin() {
  const access = await getAccessDecision();
  return access.kind === "allowed" && access.isPlatformAdmin ? access : null;
}

async function audit(input: Parameters<typeof auditDashboardAction>[0]) {
  try {
    await auditDashboardAction(input);
  } catch (error) {
    // The change itself succeeded; a missing audit row must not undo it.
    console.error("admin action: audit write failed", error);
  }
}

/** Creates the owner's login, a new tenant, its settings, its connection row and the owner row. */
export async function createOwner(input: unknown): Promise<ActionResult<{ tenantId: string }>> {
  const admin = await requirePlatformAdmin();
  if (!admin) return { ok: false, error: ADMIN_ONLY };

  const parsed = createOwnerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  }
  const { companyName, timezone, displayName, email, temporaryPassword } = parsed.data;

  const service = createAdminClient();
  const login = await createLogin(service, email, temporaryPassword);
  if (!login.ok) return login;

  // Undo everything if any step fails: deleting the tenant removes its rows (on delete cascade),
  // deleting the login removes nothing else.
  let tenantId: string | null = null;
  const undo = async (step: string, error: unknown) => {
    console.error(`createOwner: ${step} failed`, error);
    if (tenantId) await service.from("tenants").delete().eq("id", tenantId);
    await deleteLogin(service, login.userId);
    return { ok: false as const, error: "Could not create the company. Please try again." };
  };

  const tenant = await service.from("tenants").insert({ name: companyName }).select("id").single();
  if (tenant.error) return undo("tenant", tenant.error);
  tenantId = tenant.data.id;

  const settings = await service
    .from("company_settings")
    .insert({ tenant_id: tenantId, company_name: companyName, timezone });
  if (settings.error) return undo("settings", settings.error);

  const connection = await service.from("wa_connection").insert({ tenant_id: tenantId });
  if (connection.error) return undo("connection", connection.error);

  const owner = await service.from("dashboard_users").insert({
    user_id: login.userId,
    tenant_id: tenantId,
    display_name: displayName,
    role: "owner",
  });
  if (owner.error) return undo("owner", owner.error);

  // Recorded in the admin's own audit log (no password, of course).
  await audit({
    userId: admin.userId,
    tenantId: admin.tenantId,
    action: "tenant_created",
    detail: { newTenantId: tenantId, companyName, ownerName: displayName, ownerEmail: email },
  });
  revalidatePath("/admin");
  return { ok: true, data: { tenantId } };
}

/** Suspend (the company's users are shut out and its bot stops) or reactivate a tenant. */
export async function setTenantStatus(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  if (!admin) return { ok: false, error: ADMIN_ONLY };

  const parsed = setTenantStatusInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown company." };
  const { tenantId, status } = parsed.data;
  if (tenantId === admin.tenantId && status === "suspended") {
    return { ok: false, error: "You can't suspend your own company." };
  }

  const service = createAdminClient();
  const { data, error } = await service
    .from("tenants")
    .update({ status })
    .eq("id", tenantId)
    .select("name");
  if (error) {
    console.error("setTenantStatus: update failed", error);
    return { ok: false, error: "Could not update the company. Please try again." };
  }
  const tenant = data[0];
  if (!tenant) return { ok: false, error: "That company no longer exists." };

  await audit({
    userId: admin.userId,
    tenantId: admin.tenantId,
    action: status === "suspended" ? "tenant_suspended" : "tenant_reactivated",
    detail: { targetTenantId: tenantId, companyName: tenant.name },
  });
  revalidatePath("/admin");
  return { ok: true, data: undefined };
}
