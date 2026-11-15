import { dashboardRoleSchema, type DashboardRole } from "@soft-agent-support/shared";

export type AccessDecision =
  | { kind: "signed_out" }
  | { kind: "no_access" }
  | {
      kind: "allowed";
      userId: string;
      displayName: string;
      role: DashboardRole;
      tenantId: string;
      isPlatformAdmin: boolean;
    };

type DashboardUserRow = { display_name: string; role: string; tenant_id: string } | null;

/**
 * Pure role gate (ADR-019, ADR-039): a signed-in Supabase user without a valid `dashboard_users`
 * row gets no access and is signed out by the caller. A suspended tenant's users cannot read their
 * own row (RLS), so they land here as `no_access` too.
 */
export function decideAccess(
  userId: string | null,
  row: DashboardUserRow,
  isPlatformAdmin = false,
): AccessDecision {
  if (!userId) {
    return { kind: "signed_out" };
  }
  const role = dashboardRoleSchema.safeParse(row?.role);
  if (!row || !role.success || !row.tenant_id) {
    return { kind: "no_access" };
  }
  return {
    kind: "allowed",
    userId,
    displayName: row.display_name,
    role: role.data,
    tenantId: row.tenant_id,
    isPlatformAdmin,
  };
}
