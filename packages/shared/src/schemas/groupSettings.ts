// Editable group settings (dashboard group page, ui-context.md §4). Mirrors the `groups`
// column constraints in data-models.md §3.4.
import { z } from "zod";

import { reminderPermissionSchema } from "./enums.ts";

export const groupSettingsSchema = z.object({
  reminderPermission: reminderPermissionSchema,
  aiEnabled: z.boolean(),
  dailyReplyCap: z.number().int().positive("Daily cap must be at least 1"),
  /** null = keep forever. */
  retentionDays: z.number().int().positive("Retention must be at least 1 day").nullable(),
});
export type GroupSettings = z.infer<typeof groupSettingsSchema>;
