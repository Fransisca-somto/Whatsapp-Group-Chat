// Call A (api-interfaces.md §5.1): label the tagged message. The model's JSON is validated by
// parseIntentResult(); anything invalid is treated as a plain question (architecture.md §4).
import { parseIntentResult, type IntentResult } from "@soft-agent-support/shared";

import type { ChatResult, OpenRouterClient } from "../ai/openrouter.ts";
import {
  buildIntentMessages,
  extractJsonObject,
  type IntentPromptInput,
} from "./prompts/intent.ts";

export type AiAccess = { apiKey: string; chatModel: string; fallbackModel: string | null };

export async function classifyIntent(
  client: OpenRouterClient,
  ai: AiAccess,
  input: IntentPromptInput,
): Promise<{ intent: IntentResult; call: ChatResult }> {
  const call = await client.chat({
    apiKey: ai.apiKey,
    model: ai.chatModel,
    fallbackModel: ai.fallbackModel,
    messages: buildIntentMessages(input),
    temperature: 0,
    maxTokens: 150,
  });
  const json = extractJsonObject(call.text);
  return { intent: parseIntentResult(json ?? call.text), call };
}
