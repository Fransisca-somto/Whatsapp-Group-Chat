// Company and AI provider settings (Settings page, owner only; api-interfaces.md §3).
// Mirrors the company_settings constraints in data-models.md §3.1.
import { z } from "zod";

/** True when `value` is an IANA time zone this runtime knows (e.g. "Africa/Lagos"). */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const companySettingsSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "Enter the company name")
    .max(100, "Keep the name under 100 characters"),
  botDisplayName: z
    .string()
    .trim()
    .min(1, "Enter the bot's name")
    .max(50, "Keep the name under 50 characters"),
  timezone: z.string().refine(isValidTimeZone, "Choose a valid time zone"),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

/** OpenRouter keys look like `sk-or-v1-…`; the format is checked loosely, OpenRouter decides. */
export const openRouterKeyInputSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, "That doesn't look like an OpenRouter key")
    .max(500, "That doesn't look like an OpenRouter key")
    .regex(/^\S+$/, "The key can't contain spaces"),
});
export type OpenRouterKeyInput = z.infer<typeof openRouterKeyInputSchema>;

/** OpenRouter model ids look like `provider/model-name`, optionally with a `:variant`; alias ids start with `~`. */
export const MODEL_ID_REGEX = /^~?[a-z0-9][\w.-]*\/[\w.:-]+$/i;

const modelIdSchema = z
  .string()
  .trim()
  .max(200)
  .regex(MODEL_ID_REGEX, "Pick a model from the list, e.g. anthropic/claude-haiku");

export const aiModelsInputSchema = z
  .object({
    chatModel: modelIdSchema,
    /** null = no fallback (no retry). */
    fallbackModel: modelIdSchema.nullable(),
  })
  .refine((value) => value.fallbackModel !== value.chatModel, {
    message: "The fallback model must be different from the chat model",
    path: ["fallbackModel"],
  });
export type AiModelsInput = z.infer<typeof aiModelsInputSchema>;
