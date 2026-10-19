// bot_actions access (data-models.md §3.10). Append-only; never put secrets in `detail`.
import type { ActorType, Json } from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

export type AuditEntry = {
  action: string;
  actorType: ActorType;
  actorRef?: string | null;
  groupId?: string | null;
  detail?: Record<string, Json>;
  sourceWaMessageId?: string | null;
};

export type AuditStore = { record(entry: AuditEntry): Promise<void> };

export function createAuditRepo(db: ServiceClient): AuditStore {
  return {
    async record(entry) {
      const { error } = await db.from("bot_actions").insert({
        action: entry.action,
        actor_type: entry.actorType,
        actor_ref: entry.actorRef ?? null,
        group_id: entry.groupId ?? null,
        detail: entry.detail ?? {},
        source_wa_message_id: entry.sourceWaMessageId ?? null,
      });
      if (error) throw new Error(`bot_actions insert failed: ${error.message}`);
    },
  };
}
