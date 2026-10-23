// Audit log page filters and paging (api-interfaces.md §3 `loadAuditPage`).
import { z } from "zod";

export const auditFilterSchema = z.object({
  groupId: z.uuid().nullable(),
  /** One bot_actions.action value, or null for all. */
  action: z
    .string()
    .regex(/^[a-z_]{1,64}$/)
    .nullable(),
});
export type AuditFilter = z.infer<typeof auditFilterSchema>;

export const loadAuditPageInputSchema = auditFilterSchema.extend({
  /** Rows created before this ISO timestamp (the oldest row already shown). */
  before: z.iso.datetime({ offset: true }),
});
export type LoadAuditPageInput = z.infer<typeof loadAuditPageInputSchema>;
