// Authorized user form (data-models.md §3.5 and §3.6). These people may create reminders by
// tagging the bot in "admins only" groups (ADR-006, Phase 6).
import { z } from "zod";

import { phoneE164Schema } from "./phone.ts";

const authorizedUserFields = z.object({
  displayName: z.string().trim().min(1, "Name is required").max(100),
  phoneE164: phoneE164Schema,
  allGroups: z.boolean(),
  /** Used only when `allGroups` is false. */
  groupIds: z.array(z.uuid()),
  isActive: z.boolean(),
});

const needsGroups = {
  message: "Choose at least one group, or allow all groups",
  path: ["groupIds"],
};

export const authorizedUserSchema = authorizedUserFields.refine(
  (user) => user.allGroups || user.groupIds.length > 0,
  needsGroups,
);
export type AuthorizedUserInput = z.infer<typeof authorizedUserSchema>;

/** Add (no id) or edit (with id) one authorized user. */
export const upsertAuthorizedUserInputSchema = authorizedUserFields
  .extend({ id: z.uuid().optional() })
  .refine((user) => user.allGroups || user.groupIds.length > 0, needsGroups);
export type UpsertAuthorizedUserInput = z.infer<typeof upsertAuthorizedUserInputSchema>;

export const authorizedUserIdInputSchema = z.object({ id: z.uuid() });
export const setAuthorizedUserActiveInputSchema = z.object({ id: z.uuid(), isActive: z.boolean() });
