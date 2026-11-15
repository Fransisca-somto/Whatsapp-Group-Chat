// wa_auth_state access (data-models.md §3.13), one tenant's session. Values arrive already
// encrypted.
import type { ServiceClient } from "./supabase.ts";

export type AuthStateRow = { key: string; value_enc: string };

export type AuthStateStore = {
  loadAll(): Promise<AuthStateRow[]>;
  upsertMany(rows: AuthStateRow[]): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
  deleteAll(): Promise<void>;
};

// PostgREST caps responses (1000 rows by default) and very long `in (...)` filters overflow the
// URL, so reads are paged and writes are chunked.
const PAGE_SIZE = 1000;
const WRITE_CHUNK = 500;
const DELETE_CHUNK = 100;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createAuthStateRepo(db: ServiceClient, tenantId: string): AuthStateStore {
  return {
    async loadAll() {
      const rows: AuthStateRow[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await db
          .from("wa_auth_state")
          .select("key, value_enc")
          .eq("tenant_id", tenantId)
          .order("key")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(`wa_auth_state load failed: ${error.message}`);
        rows.push(...data);
        if (data.length < PAGE_SIZE) return rows;
      }
    },

    async upsertMany(rows) {
      const now = new Date().toISOString();
      for (const chunk of chunks(rows, WRITE_CHUNK)) {
        const { error } = await db.from("wa_auth_state").upsert(
          chunk.map((row) => ({ ...row, tenant_id: tenantId, updated_at: now })),
          { onConflict: "tenant_id,key" },
        );
        if (error) throw new Error(`wa_auth_state upsert failed: ${error.message}`);
      }
    },

    async deleteMany(keys) {
      for (const chunk of chunks(keys, DELETE_CHUNK)) {
        const { error } = await db
          .from("wa_auth_state")
          .delete()
          .eq("tenant_id", tenantId)
          .in("key", chunk);
        if (error) throw new Error(`wa_auth_state delete failed: ${error.message}`);
      }
    },

    async deleteAll() {
      // Only this tenant's session: never another company's.
      const { error } = await db.from("wa_auth_state").delete().eq("tenant_id", tenantId);
      if (error) throw new Error(`wa_auth_state clear failed: ${error.message}`);
    },
  };
}
