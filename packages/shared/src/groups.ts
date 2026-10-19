// Group status rules shared by the worker and the dashboard (data-models.md §3.4,
// api-interfaces.md §3). The dashboard may only move a group along these transitions; the
// worker sets `pending` (detected / re-added) and `removed` (bot left) itself.
import type { GroupStatus } from "./schemas/enums.ts";

/** Statuses whose messages are stored. Paused groups keep history; the bot just stays quiet. */
export const STORING_GROUP_STATUSES: readonly GroupStatus[] = ["active", "paused"];

/** Statuses in which the bot replies and posts. */
export const REPLYING_GROUP_STATUSES: readonly GroupStatus[] = ["active"];

export type GroupAction = "approve" | "pause" | "resume" | "archive";

const TRANSITIONS: Record<GroupAction, { from: readonly GroupStatus[]; to: GroupStatus }> = {
  approve: { from: ["pending"], to: "active" },
  pause: { from: ["active"], to: "paused" },
  resume: { from: ["paused"], to: "active" },
  archive: { from: ["pending", "active", "paused", "removed"], to: "archived" },
};

/** The status a dashboard action leads to, or null if it is not allowed from `current`. */
export function groupActionTarget(current: GroupStatus, action: GroupAction): GroupStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from.includes(current) ? rule.to : null;
}

/** Dashboard actions available for a group in this status, in display order. */
export function availableGroupActions(current: GroupStatus): GroupAction[] {
  return (Object.keys(TRANSITIONS) as GroupAction[]).filter(
    (action) => groupActionTarget(current, action) !== null,
  );
}

export function storesMessages(status: GroupStatus): boolean {
  return STORING_GROUP_STATUSES.includes(status);
}
