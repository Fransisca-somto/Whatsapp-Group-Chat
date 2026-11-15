import "server-only";

import type { Json } from "@soft-agent-support/shared";

import { createAdminClient } from "@/lib/supabase/admin";

/** Appends a dashboard-user action to bot_actions (data-models.md §3.10). No secrets in detail. */
export async function auditDashboardAction(input: {
  userId: string;
  tenantId: string;
  action: string;
  groupId?: string | null;
  detail?: Record<string, Json>;
}): Promise<void> {
  const { error } = await createAdminClient()
    .from("bot_actions")
    .insert({
      tenant_id: input.tenantId,
      actor_type: "dashboard_user",
      actor_ref: input.userId,
      action: input.action,
      group_id: input.groupId ?? null,
      detail: input.detail ?? {},
    });
  if (error) throw new Error(`audit write failed: ${error.message}`);
}
