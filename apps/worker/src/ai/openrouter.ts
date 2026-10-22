// OpenRouter chat client (api-interfaces.md §5). The only module that calls OpenRouter
// (architecture.md §3 rule 4). The key and models come from the dashboard Settings page
// (ADR-027) and are passed in per call; nothing here reads the environment.
//
// Timeout 20 s. On a timeout, network error, 429 or 5xx the call is retried once with the
// fallback model (if one is set). Any other 4xx fails at once: retrying the same request with
// another model would not fix a bad key or a malformed request.
import { chatCompletionResponseSchema } from "@soft-agent-support/shared";

import type { Logger } from "../logger.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 20_000;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatRequest = {
  apiKey: string;
  model: string;
  fallbackModel: string | null;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
};

export type ChatResult = {
  text: string;
  /** The model that answered (the fallback if the first one failed). */
  model: string;
  usedFallback: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

/** Why a call failed, in terms the pipeline and the audit log can use. */
export type OpenRouterFailure =
  | "timeout"
  | "network"
  | "rate_limited"
  | "unavailable"
  | "invalid_key"
  | "no_credits"
  | "bad_request"
  | "bad_response";

export class OpenRouterError extends Error {
  constructor(
    readonly failure: OpenRouterFailure,
    readonly status: number | null,
    message: string,
    /** Tokens and cost already spent on attempts before the failure (usually zero). */
    readonly spent: { inputTokens: number; outputTokens: number; costUsd: number } = {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    },
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

const RETRYABLE = new Set<OpenRouterFailure>(["timeout", "network", "rate_limited", "unavailable"]);

function failureForStatus(status: number): OpenRouterFailure {
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 402) return "no_credits";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

export type OpenRouterClient = { chat(request: ChatRequest): Promise<ChatResult> };

export function createOpenRouterClient(options: {
  logger: Logger;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): OpenRouterClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = options.logger.child({ module: "openrouter" });

  async function attempt(
    request: ChatRequest,
    model: string,
  ): Promise<Omit<ChatResult, "usedFallback">> {
    let response: Response;
    try {
      response = await doFetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Group Chatbot Agent",
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          usage: { include: true }, // ask OpenRouter to report the cost
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new OpenRouterError(
        timedOut ? "timeout" : "network",
        null,
        timedOut ? `no answer within ${timeoutMs} ms` : `request failed: ${String(error)}`,
      );
    }

    if (!response.ok) {
      // The error body names the problem (e.g. "Insufficient credits"); it never echoes the key.
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new OpenRouterError(
        failureForStatus(response.status),
        response.status,
        `HTTP ${response.status}: ${detail}`,
      );
    }

    const parsed = chatCompletionResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new OpenRouterError("bad_response", response.status, "unexpected response shape");
    }
    const text = parsed.data.choices[0]?.message.content?.trim() ?? "";
    const usage = parsed.data.usage;
    const result = {
      text,
      model: parsed.data.model ?? model,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      costUsd: usage?.cost ?? 0,
    };
    if (!text) {
      throw new OpenRouterError("bad_response", response.status, "empty answer", {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      });
    }
    return result;
  }

  return {
    async chat(request) {
      try {
        return { ...(await attempt(request, request.model)), usedFallback: false };
      } catch (error) {
        if (!(error instanceof OpenRouterError)) throw error;
        const fallback = request.fallbackModel;
        const retry =
          fallback && (RETRYABLE.has(error.failure) || error.failure === "bad_response");
        log.warn(
          {
            model: request.model,
            failure: error.failure,
            status: error.status,
            retry: Boolean(retry),
          },
          `chat model failed: ${error.message}`,
        );
        if (!retry) throw error;
        try {
          const result = await attempt(request, fallback);
          return {
            ...result,
            usedFallback: true,
            inputTokens: result.inputTokens + error.spent.inputTokens,
            outputTokens: result.outputTokens + error.spent.outputTokens,
            costUsd: result.costUsd + error.spent.costUsd,
          };
        } catch (fallbackError) {
          if (fallbackError instanceof OpenRouterError) {
            log.warn(
              { model: fallback, failure: fallbackError.failure, status: fallbackError.status },
              `fallback model failed: ${fallbackError.message}`,
            );
          }
          throw fallbackError;
        }
      }
    },
  };
}
