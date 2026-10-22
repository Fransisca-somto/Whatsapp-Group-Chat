// groups access (data-models.md §3.4).
import type { GroupStatus, TablesUpdate } from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

export type GroupRecord = { id: string; jid: string; name: string; status: GroupStatus };

export type GroupStore = {
  listAll(): Promise<GroupRecord[]>;
  findByJid(jid: string): Promise<GroupRecord | null>;
  /** Inserts a new pending group; returns the existing row if another call won the race. */
  insertPending(jid: string, name: string): Promise<GroupRecord>;
  rename(id: string, name: string): Promise<void>;
  setStatus(id: string, status: GroupStatus): Promise<void>;
  touchActivity(id: string, at: Date): Promise<void>;
};

const COLUMNS = "id, wa_group_jid, name, status";
const UNIQUE_VIOLATION = "23505";

type Row = { id: string; wa_group_jid: string; name: string; status: string };
const toRecord = (row: Row): GroupRecord => ({
  id: row.id,
  jid: row.wa_group_jid,
  name: row.name,
  status: row.status as GroupStatus,
});

export function createGroupsRepo(db: ServiceClient): GroupStore {
  async function findByJid(jid: string) {
    const { data, error } = await db
      .from("groups")
      .select(COLUMNS)
      .eq("wa_group_jid", jid)
      .maybeSingle();
    if (error) throw new Error(`groups read failed: ${error.message}`);
    return data ? toRecord(data) : null;
  }

  async function update(id: string, patch: TablesUpdate<"groups">) {
    const { error } = await db.from("groups").update(patch).eq("id", id);
    if (error) throw new Error(`groups update failed: ${error.message}`);
  }

  return {
    async listAll() {
      const { data, error } = await db.from("groups").select(COLUMNS);
      if (error) throw new Error(`groups read failed: ${error.message}`);
      return data.map(toRecord);
    },

    findByJid,

    async insertPending(jid, name) {
      const { data, error } = await db
        .from("groups")
        .insert({ wa_group_jid: jid, name, status: "pending" })
        .select(COLUMNS)
        .single();
      if (error?.code === UNIQUE_VIOLATION) {
        const existing = await findByJid(jid);
        if (existing) return existing;
      }
      if (error) throw new Error(`groups insert failed: ${error.message}`);
      return toRecord(data);
    },

    rename: (id, name) => update(id, { name }),

    setStatus: (id, status) => update(id, { status }),

    touchActivity: (id, at) => update(id, { last_activity_at: at.toISOString() }),
  };
}
