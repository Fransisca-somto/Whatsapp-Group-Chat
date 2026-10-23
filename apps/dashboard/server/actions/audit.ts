"use server";

// Read-only audit log paging (api-interfaces.md §3 `loadAuditPage`). Reads through RLS:
// dashboard users may read bot_actions but never write it (ADR-019).
import { loadAuditPageInputSchema } from "@soft-agent-support/shared";

import { AUDIT_COLUMNS, AUDIT_PAGE, type AuditRow } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { getAccessDecision } from "@/server/currentUser";

import type { ActionResult } from "./connection";

export async function loadAuditPage(input: unknown): Promise<ActionResult<AuditRow[]>> {
  const access = await getAccessDecision();
  if (access.kind !== "allowed") {
    return { ok: false, error: "You need dashboard access to read the audit log." };
  }

  const parsed = loadAuditPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not load older entries." };
  const { groupId, action, before } = parsed.data;

  const supabase = await createClient();
  let query = supabase
    .from("bot_actions")
    .select(AUDIT_COLUMNS)
    .lt("created_at", before)
    .order("created_at", { ascending: false })
    .limit(AUDIT_PAGE);
  if (groupId) query = query.eq("group_id", groupId);
  if (action) query = query.eq("action", action);
  const { data, error } = await query;
  if (error) {
    console.error("loadAuditPage: read failed", error);
    return { ok: false, error: "Could not load older entries. Please try again." };
  }
  return { ok: true, data: data as AuditRow[] };
}
