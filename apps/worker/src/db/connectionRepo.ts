// wa_connection access (data-models.md §3.12). One row per tenant (ADR-039).
import type { TablesUpdate, WaConnectionStatus } from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

export type ConnectionPatch = Omit<TablesUpdate<"wa_connection">, "tenant_id" | "status"> & {
  status?: WaConnectionStatus;
};

export type ConnectionStore = {
  update(patch: ConnectionPatch): Promise<void>;
};

export function createConnectionRepo(db: ServiceClient, tenantId: string): ConnectionStore {
  return {
    async update(patch) {
      const { error } = await db.from("wa_connection").update(patch).eq("tenant_id", tenantId);
      if (error) throw new Error(`wa_connection update failed: ${error.message}`);
    },
  };
}
