// OpenRouter embeddings client (api-interfaces.md §6, ADR-031). Turns text into the 1,536
// numbers the database stores in `vector(1536)` columns. Uses the same Settings-page key as the
// chat client (ADR-027); the model is fixed (P11), because another model has a different size
// and would need every message re-indexed.
//
// Timeout 20 s, no retry here: the indexing job tries again on its next run, and a question
// whose embedding fails falls back to keyword-only search.
import { embeddingsResponseSchema } from "@soft-agent-support/shared";

import { failureForStatus, OpenRouterError } from "./openrouter.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_TIMEOUT_MS = 20_000;

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
/** Texts per call. */
export const EMBEDDING_BATCH_MAX = 64;
/** The model reads up to ~8,000 tokens; longer text is cut (the start carries the meaning). */
const TEXT_MAX_CHARS = 8_000;
/** $0.02 per 1M tokens, used when OpenRouter does not report the cost. */
const USD_PER_TOKEN = 0.02 / 1_000_000;

export type EmbedResult = {
  /** One vector per input text, in input order. */
  vectors: number[][];
  inputTokens: number;
  costUsd: number;
};

export type EmbeddingsClient = { embed(apiKey: string, texts: string[]): Promise<EmbedResult> };

export function createEmbeddingsClient(
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): EmbeddingsClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async embed(apiKey, texts) {
      if (texts.length === 0) return { vectors: [], inputTokens: 0, costUsd: 0 };
      if (texts.length > EMBEDDING_BATCH_MAX) {
        throw new Error(`at most ${EMBEDDING_BATCH_MAX} texts per call, got ${texts.length}`);
      }

      let response: Response;
      try {
        response = await doFetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "Group Chatbot Agent",
          },
          body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: texts.map((text) => text.slice(0, TEXT_MAX_CHARS)),
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
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new OpenRouterError(
          failureForStatus(response.status),
          response.status,
          `HTTP ${response.status}: ${detail}`,
        );
      }

      const parsed = embeddingsResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        throw new OpenRouterError("bad_response", response.status, "unexpected response shape");
      }
      const vectors: (number[] | undefined)[] = new Array<number[] | undefined>(texts.length);
      for (const item of parsed.data.data) {
        if (item.index < texts.length) vectors[item.index] = item.embedding;
      }
      const complete = vectors.filter(
        (v): v is number[] => v !== undefined && v.length === EMBEDDING_DIMENSIONS,
      );
      if (complete.length !== texts.length) {
        throw new OpenRouterError(
          "bad_response",
          response.status,
          `expected ${texts.length} vectors of ${EMBEDDING_DIMENSIONS} numbers`,
        );
      }
      const inputTokens = parsed.data.usage?.prompt_tokens ?? 0;
      return {
        vectors: complete,
        inputTokens,
        costUsd: parsed.data.usage?.cost ?? inputTokens * USD_PER_TOKEN,
      };
    },
  };
}

/** pgvector's text form, `[0.1,0.2,…]`, which is how supabase-js passes a vector. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
