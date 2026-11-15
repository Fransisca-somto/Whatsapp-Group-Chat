// tenants (data-models.md §3.0, ADR-039): which companies the worker runs a WhatsApp session for,
// and where each company's owner alerts go.
import type { ServiceClient } from "./supabase.ts";

export type TenantStore = {
  /** Ids of every active (not suspended) tenant. */
  listActive(): Promise<string[]>;
  /** Calls back when a tenant is added, suspended or reactivated (Realtime). */
  onChange(callback: () => void): () => Promise<void>;
  /** The owner's login email (tenant_owner_email()), or null. */
  ownerEmail(tenantId: string): Promise<string | null>;
};

export function createTenantsRepo(db: ServiceClient): TenantStore {
  return {
    async listActive() {
      const { data, error } = await db
        .from("tenants")
        .select("id")
        .eq("status", "active")
        .order("created_at");
      if (error) throw new Error(`tenants read failed: ${error.message}`);
      return data.map((row) => row.id);
    },

    onChange(callback) {
      const channel = db
        .channel("worker-tenants")
        .on("postgres_changes", { event: "*", schema: "public", table: "tenants" }, () =>
          callback(),
        )
        .subscribe();
      return async () => {
        await db.removeChannel(channel);
      };
    },

    async ownerEmail(tenantId) {
      const { data, error } = await db.rpc("tenant_owner_email", { p_tenant_id: tenantId });
      if (error) throw new Error(`tenant_owner_email failed: ${error.message}`);
      return data || null;
    },
  };
}
