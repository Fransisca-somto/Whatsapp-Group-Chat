import { dashboardRoleSchema, type DashboardRole } from "@soft-agent-support/shared";

export type AccessDecision =
  | { kind: "signed_out" }
  | { kind: "no_access" }
  | { kind: "allowed"; userId: string; displayName: string; role: DashboardRole };

type DashboardUserRow = { display_name: string; role: string } | null;

/**
 * Pure role gate (ADR-019): a signed-in Supabase user without a valid `dashboard_users` row
 * gets no access and is signed out by the caller.
 */
export function decideAccess(userId: string | null, row: DashboardUserRow): AccessDecision {
  if (!userId) {
    return { kind: "signed_out" };
  }
  const role = dashboardRoleSchema.safeParse(row?.role);
  if (!row || !role.success) {
    return { kind: "no_access" };
  }
  return { kind: "allowed", userId, displayName: row.display_name, role: role.data };
}
