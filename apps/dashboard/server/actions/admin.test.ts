import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; steps: [string, unknown[]][] };
let calls: Call[] = [];
/** Result per `table:operation`; anything unset resolves to no rows and no error. */
let results: Record<string, unknown> = {};
const createUser = vi.fn();
const deleteUser = vi.fn();

function fakeAdminClient() {
  return {
    auth: { admin: { createUser, deleteUser } },
    from(table: string) {
      const call: Call = { table, steps: [] };
      calls.push(call);
      const op = () =>
        call.steps.find(([m]) => ["insert", "update", "delete"].includes(m))?.[0] ?? "select";
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "delete", "eq", "single"]) {
        builder[method] = (...args: unknown[]) => {
          call.steps.push([method, args]);
          return builder;
        };
      }
      builder.then = (onOk: (value: unknown) => unknown, onError?: (error: unknown) => unknown) =>
        Promise.resolve(results[`${table}:${op()}`] ?? { data: null, error: null }).then(
          onOk,
          onError,
        );
      return builder;
    },
  };
}

const access = { current: {} as Record<string, unknown> };
const auditDashboardAction = vi.fn(() => Promise.resolve());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdminClient() }));
vi.mock("@/server/currentUser", () => ({
  getAccessDecision: () => Promise.resolve(access.current),
}));
vi.mock("@/server/audit", () => ({ auditDashboardAction }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createOwner, setTenantStatus } = await import("./admin");

const NEW_USER = "7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c";
const NEW_TENANT = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const ADMIN = {
  kind: "allowed",
  userId: "admin-1",
  role: "owner",
  tenantId: "8b3f4e5d-6c70-4b82-8c9d-1e2f3a4b5c6d",
  isPlatformAdmin: true,
};
const input = {
  companyName: "Acme Ltd",
  timezone: "Africa/Lagos",
  displayName: "Ada",
  email: "ada@example.com",
  temporaryPassword: "temp-pass-123",
};

const insertOf = (table: string) =>
  calls.find((c) => c.table === table && c.steps.some(([m]) => m === "insert"))?.steps[0];

beforeEach(() => {
  calls = [];
  access.current = ADMIN;
  auditDashboardAction.mockClear();
  createUser.mockReset().mockResolvedValue({ data: { user: { id: NEW_USER } }, error: null });
  deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
  results = {
    "tenants:insert": { data: { id: NEW_TENANT }, error: null },
    "tenants:update": { data: [{ name: "Acme Ltd" }], error: null },
  };
});

describe("createOwner", () => {
  it("creates the login, tenant, settings, connection row and owner row", async () => {
    expect(await createOwner(input)).toEqual({ ok: true, data: { tenantId: NEW_TENANT } });
    expect(insertOf("tenants")).toEqual(["insert", [{ name: "Acme Ltd" }]]);
    expect(insertOf("company_settings")).toEqual([
      "insert",
      [{ tenant_id: NEW_TENANT, company_name: "Acme Ltd", timezone: "Africa/Lagos" }],
    ]);
    expect(insertOf("wa_connection")).toEqual(["insert", [{ tenant_id: NEW_TENANT }]]);
    expect(insertOf("dashboard_users")).toEqual([
      "insert",
      [{ user_id: NEW_USER, tenant_id: NEW_TENANT, display_name: "Ada", role: "owner" }],
    ]);
    expect(auditDashboardAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tenant_created", tenantId: ADMIN.tenantId }),
    );
    expect(JSON.stringify(auditDashboardAction.mock.calls)).not.toContain("temp-pass-123");
  });

  it("undoes the tenant and the login when a later step fails", async () => {
    results["dashboard_users:insert"] = { data: null, error: { message: "boom" } };
    expect(await createOwner(input)).toMatchObject({ ok: false });
    const tenantDelete = calls.find(
      (c) => c.table === "tenants" && c.steps.some(([m]) => m === "delete"),
    );
    expect(tenantDelete?.steps).toContainEqual(["eq", ["id", NEW_TENANT]]);
    expect(deleteUser).toHaveBeenCalledWith(NEW_USER);
  });

  it("is for platform admins only", async () => {
    access.current = { ...ADMIN, isPlatformAdmin: false };
    expect(await createOwner(input)).toMatchObject({ ok: false });
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe("setTenantStatus", () => {
  it("suspends another company", async () => {
    expect(await setTenantStatus({ tenantId: NEW_TENANT, status: "suspended" })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(auditDashboardAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tenant_suspended" }),
    );
  });

  it("never suspends the admin's own company", async () => {
    expect(await setTenantStatus({ tenantId: ADMIN.tenantId, status: "suspended" })).toEqual({
      ok: false,
      error: "You can't suspend your own company.",
    });
    expect(calls).toHaveLength(0);
  });
});
