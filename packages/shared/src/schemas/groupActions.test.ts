import { describe, expect, it } from "vitest";

import {
  changeGroupStatusInputSchema,
  loadGroupMessagesInputSchema,
  updateGroupSettingsInputSchema,
} from "./groupActions.ts";

const groupId = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

describe("group action inputs", () => {
  it("accepts a known action and rejects others", () => {
    expect(changeGroupStatusInputSchema.safeParse({ groupId, action: "approve" }).success).toBe(
      true,
    );
    expect(changeGroupStatusInputSchema.safeParse({ groupId, action: "delete" }).success).toBe(
      false,
    );
    expect(changeGroupStatusInputSchema.safeParse({ groupId: "x", action: "pause" }).success).toBe(
      false,
    );
  });

  it("validates settings with the group id", () => {
    const ok = updateGroupSettingsInputSchema.safeParse({
      groupId,
      reminderPermission: "any_member",
      aiEnabled: true,
      dailyReplyCap: 200,
      retentionDays: null,
    });
    expect(ok.success).toBe(true);
    const bad = updateGroupSettingsInputSchema.safeParse({
      groupId,
      reminderPermission: "everyone",
      aiEnabled: true,
      dailyReplyCap: 0,
      retentionDays: null,
    });
    expect(bad.success).toBe(false);
  });

  it("requires an ISO timestamp for paging", () => {
    expect(
      loadGroupMessagesInputSchema.safeParse({ groupId, before: "2026-10-19T08:00:00.000+00:00" })
        .success,
    ).toBe(true);
    expect(loadGroupMessagesInputSchema.safeParse({ groupId, before: "yesterday" }).success).toBe(
      false,
    );
  });
});
