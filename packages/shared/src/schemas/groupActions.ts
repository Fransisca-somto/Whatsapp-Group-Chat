// Dashboard → server action inputs for groups (api-interfaces.md §3).
import { z } from "zod";

import { groupSettingsSchema } from "./groupSettings.ts";

export const groupActionSchema = z.enum(["approve", "pause", "resume", "archive"]);
export type GroupAction = z.infer<typeof groupActionSchema>;

export const changeGroupStatusInputSchema = z.object({
  groupId: z.uuid(),
  action: groupActionSchema,
});
export type ChangeGroupStatusInput = z.infer<typeof changeGroupStatusInputSchema>;

export const updateGroupSettingsInputSchema = groupSettingsSchema.extend({ groupId: z.uuid() });
export type UpdateGroupSettingsInput = z.infer<typeof updateGroupSettingsInputSchema>;

/** Older messages for the group page: everything sent before `before` (ISO timestamp). */
export const loadGroupMessagesInputSchema = z.object({
  groupId: z.uuid(),
  before: z.iso.datetime({ offset: true }),
});
export type LoadGroupMessagesInput = z.infer<typeof loadGroupMessagesInputSchema>;
