import "server-only";

// Dashboard-side OpenRouter calls for the Settings page (ADR-027): check a key before it is
// saved, and list the models the owner can pick from. The worker does the chat calls.
import { openRouterModelsResponseSchema } from "@soft-agent-support/shared";

const BASE_URL = "https://openrouter.ai/api/v1";
const TIMEOUT_MS = 10_000;
const MODELS_TTL_MS = 60 * 60 * 1000;

export type KeyCheck = "valid" | "invalid" | "unreachable";

/** Asks OpenRouter whether the key is real. Never logs the key. */
export async function checkOpenRouterKey(apiKey: string): Promise<KeyCheck> {
  try {
    const response = await fetch(`${BASE_URL}/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return "valid";
    if (response.status === 401 || response.status === 403) return "invalid";
    console.error("checkOpenRouterKey: unexpected status", response.status);
    return "unreachable";
  } catch (error) {
    console.error("checkOpenRouterKey: request failed", error);
    return "unreachable";
  }
}

export type OpenRouterModel = {
  id: string;
  name: string;
  /** USD per 1M tokens, null when OpenRouter does not say. */
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
};

function perMillion(price: string | undefined): number | null {
  const value = Number(price);
  return price !== undefined && Number.isFinite(value) && value >= 0 ? value * 1_000_000 : null;
}

let cached: { at: number; models: OpenRouterModel[] } | null = null;

/**
 * Chat-capable models (text output), cached for an hour. Batch-only variants are left out,
 * since the bot answers live. Returns null when OpenRouter cannot be reached.
 */
export async function listOpenRouterModels(): Promise<OpenRouterModel[] | null> {
  if (cached && Date.now() - cached.at < MODELS_TTL_MS) return cached.models;
  try {
    const response = await fetch(`${BASE_URL}/models`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("listOpenRouterModels: unexpected status", response.status);
      return cached?.models ?? null;
    }
    const parsed = openRouterModelsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error("listOpenRouterModels: unexpected response shape", parsed.error.issues[0]);
      return cached?.models ?? null;
    }
    const models = parsed.data.data
      .filter((model) => !model.id.endsWith(":batch"))
      .filter((model) => model.architecture?.output_modalities?.includes("text") ?? true)
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        inputPricePerMillion: perMillion(model.pricing?.prompt),
        outputPricePerMillion: perMillion(model.pricing?.completion),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    cached = { at: Date.now(), models };
    return models;
  } catch (error) {
    console.error("listOpenRouterModels: request failed", error);
    return cached?.models ?? null;
  }
}
