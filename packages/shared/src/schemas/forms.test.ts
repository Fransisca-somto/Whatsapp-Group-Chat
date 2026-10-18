import { describe, expect, it } from "vitest";

import { authorizedUserSchema } from "./authorizedUser.ts";
import { groupStatusSchema, scheduledPostStatusSchema } from "./enums.ts";
import { groupSettingsSchema } from "./groupSettings.ts";

describe("groupSettingsSchema", () => {
  const valid = {
    reminderPermission: "admins_only",
    aiEnabled: true,
    dailyReplyCap: 200,
    retentionDays: null,
  };

  it("accepts valid settings, including keep-forever retention", () => {
    expect(groupSettingsSchema.safeParse(valid).success).toBe(true);
    expect(groupSettingsSchema.safeParse({ ...valid, retentionDays: 90 }).success).toBe(true);
  });

  it("rejects values the database would reject", () => {
    expect(groupSettingsSchema.safeParse({ ...valid, dailyReplyCap: 0 }).success).toBe(false);
    expect(groupSettingsSchema.safeParse({ ...valid, retentionDays: 0 }).success).toBe(false);
    expect(
      groupSettingsSchema.safeParse({ ...valid, reminderPermission: "everyone" }).success,
    ).toBe(false);
  });
});

describe("authorizedUserSchema", () => {
  const valid = {
    displayName: "Ada",
    phoneE164: "+234 801 234 5678",
    allGroups: true,
    groupIds: [],
    isActive: true,
  };

  it("normalises the phone number", () => {
    expect(authorizedUserSchema.parse(valid).phoneE164).toBe("+2348012345678");
  });

  it("requires a name", () => {
    expect(authorizedUserSchema.safeParse({ ...valid, displayName: "  " }).success).toBe(false);
  });

  it("requires groups when not allowed in all groups", () => {
    expect(authorizedUserSchema.safeParse({ ...valid, allGroups: false }).success).toBe(false);
    expect(
      authorizedUserSchema.safeParse({
        ...valid,
        allGroups: false,
        groupIds: ["7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a"],
      }).success,
    ).toBe(true);
  });
});

describe("status enums", () => {
  it("match the database check constraints", () => {
    expect(groupStatusSchema.options).toEqual([
      "pending",
      "active",
      "paused",
      "removed",
      "archived",
    ]);
    expect(scheduledPostStatusSchema.safeParse("delivery_uncertain").success).toBe(true);
    expect(scheduledPostStatusSchema.safeParse("late").success).toBe(false);
  });
});
