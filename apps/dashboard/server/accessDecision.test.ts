import { describe, expect, it } from "vitest";

import { decideAccess } from "./accessDecision";

describe("decideAccess", () => {
  it("treats a missing user as signed out", () => {
    expect(decideAccess(null, null)).toEqual({ kind: "signed_out" });
  });

  it("denies a signed-in user without a dashboard_users row", () => {
    expect(decideAccess("user-1", null)).toEqual({ kind: "no_access" });
  });

  it("denies an unknown role", () => {
    expect(decideAccess("user-1", { display_name: "Eve", role: "admin" })).toEqual({
      kind: "no_access",
    });
  });

  it("allows owners and staff with their role", () => {
    expect(decideAccess("user-1", { display_name: "Ada", role: "owner" })).toEqual({
      kind: "allowed",
      userId: "user-1",
      displayName: "Ada",
      role: "owner",
    });
    expect(decideAccess("user-2", { display_name: "Bo", role: "staff" })).toMatchObject({
      kind: "allowed",
      role: "staff",
    });
  });
});
