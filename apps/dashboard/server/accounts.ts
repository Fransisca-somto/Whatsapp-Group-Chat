import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// Logins and tenants (ADR-039). Creating or deleting a Supabase Auth user needs the service-role
// key, so this module (and the Admin / Team actions that call it) use the admin client. Every
// caller checks the role first: platform admin for tenants, the tenant's owner for staff.

type Admin = ReturnType<typeof createAdminClient>;

export type TenantView = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  connection: string | null;
  linkedPhone: string | null;
  staffCount: number;
};

export type TeamMemberView = {
  userId: string;
  displayName: string;
  role: string;
  email: string | null;
  createdAt: string;
};

/** Emails by user id. Few logins per deployment, so one page of 1,000 is plenty. */
async function emailsById(admin: Admin): Promise<Map<string, string>> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Could not list logins: ${error.message}`);
  return new Map(data.users.map((user) => [user.id, user.email ?? ""]));
}

/** Creates a confirmed login with a temporary password. */
export async function createLogin(
  admin: Admin,
  email: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    if (error?.code === "email_exists" || error?.status === 422) {
      return { ok: false, error: "That email already has a login." };
    }
    if (error?.code === "weak_password") {
      return { ok: false, error: "That password is too weak. Use a longer one." };
    }
    console.error("createLogin failed", error?.code, error?.message);
    return { ok: false, error: "Could not create the login. Please try again." };
  }
  return { ok: true, userId: data.user.id };
}

/** Deletes a login; its dashboard_users row goes with it (on delete cascade). */
export async function deleteLogin(admin: Admin, userId: string): Promise<boolean> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("deleteLogin failed", error.code, error.message);
    return false;
  }
  return true;
}

/** Admin page: every tenant with its owner and WhatsApp status. Platform admins only. */
export async function loadTenants(): Promise<TenantView[]> {
  const admin = createAdminClient();
  const [tenants, users, connections, emails] = await Promise.all([
    admin.from("tenants").select("id, name, status, created_at").order("created_at"),
    admin.from("dashboard_users").select("user_id, tenant_id, display_name, role"),
    admin.from("wa_connection").select("tenant_id, status, linked_phone_e164"),
    emailsById(admin),
  ]);
  for (const result of [tenants, users, connections]) {
    if (result.error) throw new Error(`Could not load companies: ${result.error.message}`);
  }
  return (tenants.data ?? []).map((tenant) => {
    const members = (users.data ?? []).filter((user) => user.tenant_id === tenant.id);
    const owner = members.find((user) => user.role === "owner");
    const connection = (connections.data ?? []).find((c) => c.tenant_id === tenant.id);
    return {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.created_at,
      ownerName: owner?.display_name ?? null,
      ownerEmail: owner ? (emails.get(owner.user_id) ?? null) : null,
      connection: connection?.status ?? null,
      linkedPhone: connection?.linked_phone_e164 ?? null,
      staffCount: members.filter((user) => user.role === "staff").length,
    };
  });
}

/** Team page: the tenant's owner and staff with their login emails. The tenant's owner only. */
export async function loadTeam(tenantId: string): Promise<TeamMemberView[]> {
  const admin = createAdminClient();
  const [members, emails] = await Promise.all([
    admin
      .from("dashboard_users")
      .select("user_id, display_name, role, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at"),
    emailsById(admin),
  ]);
  if (members.error) throw new Error(`Could not load the team: ${members.error.message}`);
  return (members.data ?? []).map((member) => ({
    userId: member.user_id,
    displayName: member.display_name,
    role: member.role,
    email: emails.get(member.user_id) ?? null,
    createdAt: member.created_at,
  }));
}
