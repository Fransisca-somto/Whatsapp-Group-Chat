// Dashboard input for reminders and announcements (scheduled_posts, data-models.md §3.9,
// Workflow/Phases/07-Scheduler.md P14–P16, 09-Post-Attachments.md P32). The time is a
// wall-clock time in the company timezone; the server converts it and checks it is 1 minute to
// 1 year ahead.
import { z } from "zod";

import { attachmentSchema } from "../attachments.ts";
import { repeatRuleSchema } from "../recurrence.ts";
import { scheduledPostKindSchema } from "./enums.ts";

/** Mirrors the migration 0012/0014 check constraint. */
export const SCHEDULED_POST_BODY_MAX = 2000;

const scheduledPostFields = z.object({
  groupId: z.uuid({ error: "Pick a group" }),
  kind: scheduledPostKindSchema,
  /** May be empty when there is an attachment (P32). */
  body: z
    .string()
    .trim()
    .max(
      SCHEDULED_POST_BODY_MAX,
      `Keep it under ${SCHEDULED_POST_BODY_MAX.toLocaleString("en")} characters`,
    ),
  /** `YYYY-MM-DDTHH:mm` in the company timezone; for a repeating post, when it starts. */
  dueAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time"),
  /** null for a one-off post. */
  repeat: repeatRuleSchema.nullable(),
  /** One uploaded file or recorded voice note, or none (Phase 6, 6.6). */
  attachment: attachmentSchema.nullable().default(null),
});

const needsContent = {
  message: "Write the message",
  path: ["body"],
};
const hasContent = (post: { body: string; attachment: unknown }) =>
  post.body.length > 0 || post.attachment !== null;

export const scheduledPostInputSchema = scheduledPostFields.refine(hasContent, needsContent);
export type ScheduledPostInput = z.infer<typeof scheduledPostInputSchema>;

export const updateScheduledPostInputSchema = scheduledPostFields
  .extend({ id: z.uuid() })
  .refine(hasContent, needsContent);
export type UpdateScheduledPostInput = z.infer<typeof updateScheduledPostInputSchema>;

/** Cancel, resend and dismiss take only the post. */
export const scheduledPostIdInputSchema = z.object({ id: z.uuid() });
export type ScheduledPostIdInput = z.infer<typeof scheduledPostIdInputSchema>;
