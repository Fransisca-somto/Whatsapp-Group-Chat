// wa_connection access (data-models.md §3.12). Single row, id = 1.
import type { TablesUpdate, WaConnectionStatus } from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

export type ConnectionPatch = Omit<TablesUpdate<"wa_connection">, "id" | "status"> & {
  status?: WaConnectionStatus;
};

export type ConnectionStore = {
  update(patch: ConnectionPatch): Promise<void>;
};

export function createConnectionRepo(db: ServiceClient): ConnectionStore {
  return {
    async update(patch) {
      const { error } = await db.from("wa_connection").update(patch).eq("id", 1);
      if (error) throw new Error(`wa_connection update failed: ${error.message}`);
    },
  };
}
