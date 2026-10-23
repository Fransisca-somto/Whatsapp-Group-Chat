import { describe, expect, it } from "vitest";

import { canCreateReminder, type AuthorizedUser } from "./permission.ts";

const ADA: AuthorizedUser = { phoneE164: "+2348012345678", allGroups: true, groupIds: [] };
const BOLA: AuthorizedUser = { phoneE164: "+2348099999999", allGroups: false, groupIds: ["g2"] };

const decide = (permission: "admins_only" | "any_member", senderPhone: string | null) =>
  canCreateReminder({ permission, groupId: "g1", senderPhone, authorizedUsers: [ADA, BOLA] });

describe("canCreateReminder", () => {
  it("lets anyone set reminders in an any-member group, even with a hidden number", () => {
    expect(decide("any_member", null)).toBe("allowed");
    expect(decide("any_member", "+2347000000000")).toBe("allowed");
  });

  it("in an admins-only group, needs a listed number for all groups or this group", () => {
    expect(decide("admins_only", ADA.phoneE164)).toBe("allowed");
    expect(decide("admins_only", BOLA.phoneE164)).toBe("not_authorized"); // listed for g2 only
    expect(
      canCreateReminder({
        permission: "admins_only",
        groupId: "g2",
        senderPhone: BOLA.phoneE164,
        authorizedUsers: [BOLA],
      }),
    ).toBe("allowed");
    expect(decide("admins_only", "+2347000000000")).toBe("not_authorized");
  });

  it("refuses a hidden number in an admins-only group", () => {
    expect(decide("admins_only", null)).toBe("no_phone");
  });
});
