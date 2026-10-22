// OpenRouter responses are external input (architecture.md §12): parsed before use.
import { z } from "zod";

/** `GET /api/v1/models`: only the fields the Settings page uses. */
export const openRouterModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      pricing: z
        .object({ prompt: z.string().optional(), completion: z.string().optional() })
        .optional(),
      architecture: z.object({ output_modalities: z.array(z.string()).optional() }).optional(),
    }),
  ),
});
export type OpenRouterModelsResponse = z.infer<typeof openRouterModelsResponseSchema>;

/** `POST /api/v1/chat/completions`: only the fields the worker uses (api-interfaces.md §5). */
export const chatCompletionResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative().optional(),
      completion_tokens: z.number().nonnegative().optional(),
      /** USD, present when usage accounting is on. */
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});
export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;
