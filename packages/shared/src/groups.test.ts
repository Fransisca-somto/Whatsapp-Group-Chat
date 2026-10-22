import { describe, expect, it } from "vitest";

import { availableGroupActions, groupActionTarget, storesMessages } from "./groups.ts";

describe("group status rules", () => {
  it("allows the approved transitions", () => {
    expect(groupActionTarget("pending", "approve")).toBe("active");
    expect(groupActionTarget("active", "pause")).toBe("paused");
    expect(groupActionTarget("paused", "resume")).toBe("active");
    expect(groupActionTarget("removed", "archive")).toBe("archived");
  });

  it("blocks everything else", () => {
    expect(groupActionTarget("active", "approve")).toBeNull();
    expect(groupActionTarget("removed", "resume")).toBeNull(); // the bot is not in the group
    expect(groupActionTarget("archived", "archive")).toBeNull();
    expect(groupActionTarget("archived", "approve")).toBeNull();
  });

  it("lists the actions per status", () => {
    expect(availableGroupActions("pending")).toEqual(["approve", "archive"]);
    expect(availableGroupActions("active")).toEqual(["pause", "archive"]);
    expect(availableGroupActions("paused")).toEqual(["resume", "archive"]);
    expect(availableGroupActions("removed")).toEqual(["archive"]);
    expect(availableGroupActions("archived")).toEqual([]);
  });

  it("stores messages for active and paused groups only", () => {
    expect(storesMessages("active")).toBe(true);
    expect(storesMessages("paused")).toBe(true);
    expect(storesMessages("pending")).toBe(false);
    expect(storesMessages("removed")).toBe(false);
    expect(storesMessages("archived")).toBe(false);
  });
});
