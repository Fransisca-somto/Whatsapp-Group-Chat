import { describe, expect, it } from "vitest";

import { decideAccess } from "./accessDecision";

describe("decideAccess", () => {
  it("treats a missing user as signed out", () => {
    expect(decideAccess(null, null)).toEqual({ kind: "signed_out" });
  });

  it("denies a signed-in user without a dashboard_users row (none, or a suspended tenant)", () => {
    expect(decideAccess("user-1", null)).toEqual({ kind: "no_access" });
  });

  it("denies an unknown role", () => {
    expect(
      decideAccess("user-1", { display_name: "Eve", role: "admin", tenant_id: "t-1" }),
    ).toEqual({ kind: "no_access" });
  });

  it("denies a row without a tenant", () => {
    expect(decideAccess("user-1", { display_name: "Eve", role: "owner", tenant_id: "" })).toEqual({
      kind: "no_access",
    });
  });

  it("allows owners and staff with their role, tenant and admin flag", () => {
    expect(
      decideAccess("user-1", { display_name: "Ada", role: "owner", tenant_id: "t-1" }, true),
    ).toEqual({
      kind: "allowed",
      userId: "user-1",
      displayName: "Ada",
      role: "owner",
      tenantId: "t-1",
      isPlatformAdmin: true,
    });
    expect(
      decideAccess("user-2", { display_name: "Bo", role: "staff", tenant_id: "t-2" }),
    ).toMatchObject({ kind: "allowed", role: "staff", tenantId: "t-2", isPlatformAdmin: false });
  });
});
