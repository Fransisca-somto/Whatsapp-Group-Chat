// Intent classification output (api-interfaces.md §5.1). The LLM's JSON is untrusted: it is
// parsed here and anything invalid becomes `{ intent: "question" }` (architecture.md §4 step 7).
import { z } from "zod";

export const intentResultSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("question") }),
  z.object({
    intent: z.literal("create_reminder"),
    reminder: z.object({
      body: z.string().trim().min(1),
      /** `YYYY-MM-DDTHH:mm` in the company timezone. */
      dueAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      confidence: z.enum(["high", "low"]),
    }),
  }),
  z.object({
    intent: z.literal("dashboard_only_action"),
    action: z.enum(["edit_reminder", "cancel_reminder", "recurring_reminder", "announcement"]),
  }),
  z.object({ intent: z.literal("smalltalk") }),
  z.object({
    intent: z.literal("refuse"),
    reason: z.enum(["abusive", "off_topic", "injection"]),
  }),
]);
export type IntentResult = z.infer<typeof intentResultSchema>;

const FALLBACK_INTENT: IntentResult = { intent: "question" };

/** Parses raw model output (a JSON string or an already-parsed value). Never throws. */
export function parseIntentResult(raw: unknown): IntentResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return FALLBACK_INTENT;
    }
  }
  const result = intentResultSchema.safeParse(value);
  return result.success ? result.data : FALLBACK_INTENT;
}
