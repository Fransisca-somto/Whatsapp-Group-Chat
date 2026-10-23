import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; steps: [string, unknown[]][] };
let calls: Call[] = [];
/** Result per `table:operation`; anything unset resolves to no rows and no error. */
let results: Record<string, unknown> = {};

function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { table, steps: [] };
      calls.push(call);
      const op = () =>
        call.steps.find(([m]) => ["insert", "update", "delete"].includes(m))?.[0] ?? "select";
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "delete", "eq", "in", "order"]) {
        builder[method] = (...args: unknown[]) => {
          call.steps.push([method, args]);
          return builder;
        };
      }
      builder.then = (onOk: (value: unknown) => unknown, onError?: (error: unknown) => unknown) =>
        Promise.resolve(results[`${table}:${op()}`] ?? { data: [], error: null }).then(
          onOk,
          onError,
        );
      return builder;
    },
  };
}

const access = {
  current: { kind: "allowed", userId: "u1", role: "staff" } as Record<string, unknown>,
};
const auditDashboardAction = vi.fn(() => Promise.resolve());
vi.mock("@/lib/supabase/server", () => ({ createClient: () => Promise.resolve(fakeClient()) }));
vi.mock("@/server/currentUser", () => ({
  getAccessDecision: () => Promise.resolve(access.current),
}));
vi.mock("@/server/audit", () => ({ auditDashboardAction }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { deleteAuthorizedUser, setAuthorizedUserActive, upsertAuthorizedUser } =
  await import("./authorizedUsers");

const USER_ID = "7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c";
const GROUP_A = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const GROUP_B = "8b3f4e5d-6c70-4b82-8c9d-1e2f3a4b5c6d";
const input = {
  displayName: "Ada",
  phoneE164: "+234 801 234 5678",
  allGroups: false,
  groupIds: [GROUP_A, GROUP_B],
  isActive: true,
};

const stepsFor = (table: string, method: string) =>
  calls.filter((c) => c.table === table && c.steps.some(([m]) => m === method));

beforeEach(() => {
  calls = [];
  access.current = { kind: "allowed", userId: "u1", role: "staff" };
  auditDashboardAction.mockClear();
  results = {
    "authorized_users:insert": { data: [{ id: USER_ID }], error: null },
    "authorized_users:update": { data: [{ id: USER_ID, display_name: "Ada" }], error: null },
    "authorized_users:delete": { data: [{ id: USER_ID, display_name: "Ada" }], error: null },
  };
});

describe("upsertAuthorizedUser", () => {
  it("adds a person with their groups, the number in E.164, and audits", async () => {
    expect(await upsertAuthorizedUser(input)).toEqual({ ok: true, data: { id: USER_ID } });
    expect(stepsFor("authorized_users", "insert")[0]?.steps[0]).toEqual([
      "insert",
      [{ display_name: "Ada", phone_e164: "+2348012345678", all_groups: false, is_active: true }],
    ]);
    // Old links cleared, then the chosen groups linked.
    expect(stepsFor("authorized_user_groups", "delete")[0]?.steps).toContainEqual([
      "eq",
      ["authorized_user_id", USER_ID],
    ]);
    expect(stepsFor("authorized_user_groups", "insert")[0]?.steps[0]).toEqual([
      "insert",
      [
        [
          { authorized_user_id: USER_ID, group_id: GROUP_A },
          { authorized_user_id: USER_ID, group_id: GROUP_B },
        ],
      ],
    ]);
    expect(auditDashboardAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "authorized_user_added" }),
    );
  });

  it("links no groups for someone allowed everywhere", async () => {
    await upsertAuthorizedUser({ ...input, id: USER_ID, allGroups: true, groupIds: [] });
    expect(stepsFor("authorized_users", "update")).toHaveLength(1);
    expect(stepsFor("authorized_user_groups", "insert")).toHaveLength(0);
  });

  it("explains a number that is already on the list", async () => {
    results["authorized_users:insert"] = { data: null, error: { code: "23505", message: "dup" } };
    expect(await upsertAuthorizedUser(input)).toEqual({
      ok: false,
      error: "This number is already on the list.",
    });
  });

  it("refuses without dashboard access or with a bad number", async () => {
    expect(await upsertAuthorizedUser({ ...input, phoneE164: "0801234" })).toMatchObject({
      ok: false,
    });
    access.current = { kind: "no_access" };
    expect(await upsertAuthorizedUser(input)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});

describe("turning off and removing", () => {
  it("turns a person off", async () => {
    expect(await setAuthorizedUserActive({ id: USER_ID, isActive: false })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(stepsFor("authorized_users", "update")[0]?.steps[0]).toEqual([
      "update",
      [{ is_active: false }],
    ]);
  });

  it("removes a person", async () => {
    expect(await deleteAuthorizedUser({ id: USER_ID })).toEqual({ ok: true, data: undefined });
    expect(auditDashboardAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "authorized_user_deleted" }),
    );
  });
});
