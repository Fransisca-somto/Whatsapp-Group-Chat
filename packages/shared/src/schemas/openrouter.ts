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
