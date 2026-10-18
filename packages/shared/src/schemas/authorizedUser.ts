// Authorized user form (data-models.md §3.5 and §3.6).
import { z } from "zod";

import { phoneE164Schema } from "./phone.ts";

export const authorizedUserSchema = z
  .object({
    displayName: z.string().trim().min(1, "Name is required").max(100),
    phoneE164: phoneE164Schema,
    allGroups: z.boolean(),
    /** Used only when `allGroups` is false. */
    groupIds: z.array(z.uuid()),
    isActive: z.boolean(),
  })
  .refine((user) => user.allGroups || user.groupIds.length > 0, {
    message: "Choose at least one group, or allow all groups",
    path: ["groupIds"],
  });
export type AuthorizedUserInput = z.infer<typeof authorizedUserSchema>;
