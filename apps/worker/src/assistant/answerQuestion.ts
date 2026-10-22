// Call B (api-interfaces.md §5.2): write the answer, or report that the reference data has none.
import type { ChatResult, OpenRouterClient } from "../ai/openrouter.ts";
import type { AiAccess } from "./classifyIntent.ts";
import { formatReply } from "./formatReply.ts";
import {
  buildAnswerMessages,
  buildSmalltalkMessages,
  NO_ANSWER_MARKER,
  type AnswerPromptInput,
} from "./prompts/answer.ts";

export type Answer =
  | { kind: "answer"; text: string; long: boolean; call: ChatResult }
  | { kind: "dont_know"; call: ChatResult };

export async function answerQuestion(
  client: OpenRouterClient,
  ai: AiAccess,
  input: AnswerPromptInput,
): Promise<Answer> {
  const call = await client.chat({
    apiKey: ai.apiKey,
    model: ai.chatModel,
    fallbackModel: ai.fallbackModel,
    messages: buildAnswerMessages(input),
    temperature: 0.3,
    maxTokens: 300,
  });
  // Any reply carrying the marker means "not in the reference data", even with extra words.
  if (call.text.includes(NO_ANSWER_MARKER)) return { kind: "dont_know", call };
  const reply = formatReply(call.text);
  if (!reply.text) return { kind: "dont_know", call };
  return { kind: "answer", text: reply.text, long: reply.long, call };
}

export async function replyToSmalltalk(
  client: OpenRouterClient,
  ai: AiAccess,
  input: { companyName: string; botName: string; message: string },
): Promise<{ text: string; call: ChatResult }> {
  const call = await client.chat({
    apiKey: ai.apiKey,
    model: ai.chatModel,
    fallbackModel: ai.fallbackModel,
    messages: buildSmalltalkMessages(input),
    temperature: 0.5,
    maxTokens: 60,
  });
  return { text: formatReply(call.text).text, call };
}
