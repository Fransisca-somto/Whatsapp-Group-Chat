"use server";

// Owner-only connection actions (api-interfaces.md §3). The worker picks up the row through
// Realtime / polling (§2.1); the dashboard never talks to the worker directly.
import { cancelPairingInputSchema, pairingRequestInputSchema } from "@soft-agent-support/shared";

import { createClient } from "@/lib/supabase/server";
import { auditDashboardAction } from "@/server/audit";
import { getAccessDecision } from "@/server/currentUser";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const UNIQUE_VIOLATION = "23505";

async function requireOwner() {
  const access = await getAccessDecision();
  if (access.kind !== "allowed" || access.role !== "owner") return null;
  return access;
}

export async function requestPairing(input: unknown): Promise<ActionResult<{ id: string }>> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: "Only the owner can link or relink the number." };

  const parsed = pairingRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the phone number." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pairing_requests")
    .insert({
      kind: parsed.data.kind,
      phone_e164: parsed.data.phoneE164,
      requested_by: owner.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "A pairing request is already open. Cancel it first." };
    }
    console.error("requestPairing: insert failed", error);
    return { ok: false, error: "Could not create the pairing request. Please try again." };
  }

  try {
    await auditDashboardAction({
      userId: owner.userId,
      action: parsed.data.kind === "relink" ? "relink_requested" : "pairing_requested",
      detail: { pairingRequestId: data.id, phoneE164: parsed.data.phoneE164 },
    });
  } catch (auditError) {
    // The request itself succeeded; a missing audit row must not block linking.
    console.error("requestPairing: audit write failed", auditError);
  }
  return { ok: true, data: { id: data.id } };
}

export async function cancelPairing(input: unknown): Promise<ActionResult> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: "Only the owner can cancel pairing." };

  const parsed = cancelPairingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown pairing request." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("pairing_requests")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.requestId)
    .in("status", ["requested", "code_issued"]);
  if (error) {
    console.error("cancelPairing: update failed", error);
    return { ok: false, error: "Could not cancel the pairing request. Please try again." };
  }
  return { ok: true, data: undefined };
}
