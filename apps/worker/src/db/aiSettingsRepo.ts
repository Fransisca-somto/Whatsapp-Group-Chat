// Company and AI provider settings for the assistant (data-models.md §3.1, §5.6; ADR-027).
// The OpenRouter key is read from Vault through get_openrouter_key() (service role only).
import type { ServiceClient } from "./supabase.ts";

export type AssistantSettings = {
  companyName: string;
  botName: string;
  timezone: string;
  /** null until the owner saves a key on the Settings page. */
  apiKey: string | null;
  chatModel: string | null;
  fallbackModel: string | null;
};

export type AiSettingsStore = { load(): Promise<AssistantSettings> };

export function createAiSettingsRepo(db: ServiceClient): AiSettingsStore {
  return {
    async load() {
      const [settings, key] = await Promise.all([
        db
          .from("company_settings")
          .select("company_name, bot_display_name, timezone, ai_chat_model, ai_fallback_model")
          .eq("id", 1)
          .maybeSingle(),
        db.rpc("get_openrouter_key"),
      ]);
      if (settings.error)
        throw new Error(`company_settings read failed: ${settings.error.message}`);
      if (key.error) throw new Error(`get_openrouter_key failed: ${key.error.message}`);
      if (!settings.data) throw new Error("company_settings row is missing (run the seed)");
      return {
        companyName: settings.data.company_name,
        botName: settings.data.bot_display_name,
        timezone: settings.data.timezone,
        apiKey: key.data || null,
        chatModel: settings.data.ai_chat_model,
        fallbackModel: settings.data.ai_fallback_model,
      };
    },
  };
}

/** Wraps a store so settings are read at most once per `ttlMs` (api-interfaces.md §2.3: 60 s). */
export function cachedAiSettings(
  store: AiSettingsStore,
  ttlMs = 60_000,
  now: () => number = Date.now,
): AiSettingsStore {
  let cached: { at: number; value: AssistantSettings } | null = null;
  return {
    async load() {
      if (cached && now() - cached.at < ttlMs) return cached.value;
      const value = await store.load();
      cached = { at: now(), value };
      return value;
    },
  };
}
