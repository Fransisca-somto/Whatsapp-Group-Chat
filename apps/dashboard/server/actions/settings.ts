"use server";

// Owner-only Settings actions (api-interfaces.md §3, ADR-027). The OpenRouter key goes straight
// to Supabase Vault through set_openrouter_key(), which re-checks the owner role in the
// database; it is never stored in a table, returned to the browser or written to the audit log.
import {
  aiModelsInputSchema,
  companySettingsSchema,
  openRouterKeyInputSchema,
} from "@soft-agent-support/shared";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { auditDashboardAction } from "@/server/audit";
import { getAccessDecision } from "@/server/currentUser";
import { checkOpenRouterKey, listOpenRouterModels } from "@/server/openrouter";

import type { ActionResult } from "./connection";

const OWNER_ONLY = "Only the owner can change settings.";

async function requireOwner() {
  const access = await getAccessDecision();
  if (access.kind !== "allowed" || access.role !== "owner") return null;
  return access;
}

async function audit(input: Parameters<typeof auditDashboardAction>[0]) {
  try {
    await auditDashboardAction(input);
  } catch (error) {
    // The change itself succeeded; a missing audit row must not undo it.
    console.error("settings action: audit write failed", error);
  }
}

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function updateCompanySettings(input: unknown): Promise<ActionResult> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };

  const parsed = companySettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the settings." };
  }
  const { companyName, botDisplayName, timezone } = parsed.data;

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("company_settings")
    .update({ company_name: companyName, bot_display_name: botDisplayName, timezone })
    .eq("id", 1)
    .select("id");
  if (error) {
    console.error("updateCompanySettings: update failed", error);
    return { ok: false, error: "Could not save the settings. Please try again." };
  }
  if (updated.length === 0) {
    return { ok: false, error: "Company settings are missing. Run the setup seed first." };
  }

  await audit({
    userId: owner.userId,
    action: "company_settings_updated",
    detail: { companyName, botDisplayName, timezone },
  });
  refresh();
  return { ok: true, data: undefined };
}

export async function saveOpenRouterKey(input: unknown): Promise<ActionResult<{ hint: string }>> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };

  const parsed = openRouterKeyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the key." };
  }
  const { apiKey } = parsed.data;

  const check = await checkOpenRouterKey(apiKey);
  if (check === "invalid") {
    return { ok: false, error: "That key was rejected by OpenRouter. Check it and try again." };
  }
  if (check === "unreachable") {
    return { ok: false, error: "Couldn't reach OpenRouter to check the key. Please try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_openrouter_key", { p_key: apiKey });
  if (error) {
    console.error("saveOpenRouterKey: rpc failed", error.code, error.message);
    return { ok: false, error: "Could not save the key. Please try again." };
  }

  const hint = apiKey.slice(-4);
  await audit({ userId: owner.userId, action: "ai_key_saved", detail: { hint } });
  refresh();
  return { ok: true, data: { hint } };
}

export async function removeOpenRouterKey(): Promise<ActionResult> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };

  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_openrouter_key");
  if (error) {
    console.error("removeOpenRouterKey: rpc failed", error.code, error.message);
    return { ok: false, error: "Could not remove the key. Please try again." };
  }

  await audit({ userId: owner.userId, action: "ai_key_removed" });
  refresh();
  return { ok: true, data: undefined };
}

export async function updateAiModels(input: unknown): Promise<ActionResult> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };

  const parsed = aiModelsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the models." };
  }
  const { chatModel, fallbackModel } = parsed.data;

  const models = await listOpenRouterModels();
  if (!models) {
    return {
      ok: false,
      error: "Couldn't reach OpenRouter to check the models. Please try again.",
    };
  }
  const known = new Set(models.map((model) => model.id));
  for (const model of [chatModel, fallbackModel]) {
    if (model && !known.has(model)) {
      return {
        ok: false,
        error: `OpenRouter has no model called “${model}”. Pick one from the list.`,
      };
    }
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("company_settings")
    .update({ ai_chat_model: chatModel, ai_fallback_model: fallbackModel })
    .eq("id", 1)
    .select("id");
  if (error) {
    console.error("updateAiModels: update failed", error);
    return { ok: false, error: "Could not save the models. Please try again." };
  }
  if (updated.length === 0) {
    return { ok: false, error: "Company settings are missing. Run the setup seed first." };
  }

  await audit({
    userId: owner.userId,
    action: "ai_models_updated",
    detail: { chatModel, fallbackModel },
  });
  refresh();
  return { ok: true, data: undefined };
}
