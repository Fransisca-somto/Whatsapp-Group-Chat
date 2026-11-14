"use server";

// Anyone signed in changes their own password (ADR-039: logins start with a temporary one).
// Runs with the user's own session; no service role.
import { changePasswordInputSchema } from "@soft-agent-support/shared";

import { createClient } from "@/lib/supabase/server";
import { auditDashboardAction } from "@/server/audit";
import { getAccessDecision } from "@/server/currentUser";

import type { ActionResult } from "./connection";

export async function changePassword(input: unknown): Promise<ActionResult> {
  const access = await getAccessDecision();
  if (access.kind !== "allowed") return { ok: false, error: "Please log in again." };

  const parsed = changePasswordInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return { ok: false, error: "Choose a password different from the current one." };
    }
    if (error.code === "weak_password") {
      return { ok: false, error: "That password is too weak. Use a longer one." };
    }
    console.error("changePassword failed", error.code, error.message);
    return { ok: false, error: "Could not change the password. Please try again." };
  }

  try {
    await auditDashboardAction({
      userId: access.userId,
      tenantId: access.tenantId,
      action: "password_changed",
    });
  } catch (auditError) {
    console.error("changePassword: audit write failed", auditError);
  }
  return { ok: true, data: undefined };
}
