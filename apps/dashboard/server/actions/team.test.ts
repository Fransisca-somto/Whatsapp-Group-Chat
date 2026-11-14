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
      for (const method of ["select", "insert", "update", "delete", "eq", "maybeSingle"]) {
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

const { addStaff, removeStaff } = await import("./team");

const STAFF_ID = "7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c";
const input = { displayName: "Bo", email: "Bo@Example.com", temporaryPassword: "temp-pass-123" };
const OWNER = { kind: "allowed", userId: "owner-1", role: "owner", tenantId: "t1" };

const stepsFor = (table: string, method: string) =>
  calls.filter((c) => c.table === table && c.steps.some(([m]) => m === method));

beforeEach(() => {
  calls = [];
  results = {};
  access.current = OWNER;
  auditDashboardAction.mockClear();
  createUser.mockReset().mockResolvedValue({ data: { user: { id: STAFF_ID } }, error: null });
  deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe("addStaff", () => {
  it("creates a confirmed login and a staff row in the owner's own tenant", async () => {
    expect(await addStaff(input)).toEqual({ ok: true, data: { userId: STAFF_ID } });
    expect(createUser).toHaveBeenCalledWith({
      email: "bo@example.com",
      password: "temp-pass-123",
      email_confirm: true,
    });
    expect(stepsFor("dashboard_users", "insert")[0]?.steps[0]).toEqual([
      "insert",
      [{ user_id: STAFF_ID, tenant_id: "t1", display_name: "Bo", role: "staff" }],
    ]);
    expect(auditDashboardAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staff_added", tenantId: "t1" }),
    );
    // The temporary password is never written to the audit log.
    expect(JSON.stringify(auditDashboardAction.mock.calls)).not.toContain("temp-pass-123");
  });

  it("deletes the new login again if the staff row cannot be written", async () => {
    results["dashboard_users:insert"] = { data: null, error: { message: "boom" } };
    expect(await addStaff(input)).toMatchObject({ ok: false });
    expect(deleteUser).toHaveBeenCalledWith(STAFF_ID);
  });

  it("explains an email that already has a login", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "exists" },
    });
    expect(await addStaff(input)).toEqual({ ok: false, error: "That email already has a login." });
    expect(calls).toHaveLength(0);
  });

  it("refuses staff and people without access", async () => {
    access.current = { ...OWNER, role: "staff" };
    expect(await addStaff(input)).toMatchObject({ ok: false });
    access.current = { kind: "no_access" };
    expect(await addStaff(input)).toMatchObject({ ok: false });
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe("removeStaff", () => {
  it("removes only staff of the owner's own tenant", async () => {
    results["dashboard_users:select"] = { data: { display_name: "Bo" }, error: null };
    expect(await removeStaff({ userId: STAFF_ID })).toEqual({ ok: true, data: undefined });
    const lookup = stepsFor("dashboard_users", "select")[0]?.steps ?? [];
    expect(lookup).toContainEqual(["eq", ["tenant_id", "t1"]]);
    expect(lookup).toContainEqual(["eq", ["role", "staff"]]);
    expect(deleteUser).toHaveBeenCalledWith(STAFF_ID);
  });

  it("does nothing for someone outside the team (another tenant, or the owner)", async () => {
    results["dashboard_users:select"] = { data: null, error: null };
    expect(await removeStaff({ userId: STAFF_ID })).toEqual({
      ok: false,
      error: "That person is not on your team.",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
