// groups access (data-models.md §3.4).
import type { GroupStatus, ReminderPermission, TablesUpdate } from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

export type GroupRecord = { id: string; jid: string; name: string; status: GroupStatus };

/** The settings the assistant needs for one tagged message, read fresh each time. */
export type GroupAssistantSettings = {
  aiEnabled: boolean;
  /** ADR-030: general questions may be answered from the model's own knowledge. */
  allowGeneralKnowledge: boolean;
  dailyReplyCap: number;
  botInstructions: string | null;
  /** Who may create reminders by tagging the bot (Phase 6). */
  reminderPermission: ReminderPermission;
};

export type GroupStore = {
  listAll(): Promise<GroupRecord[]>;
  findByJid(jid: string): Promise<GroupRecord | null>;
  /** Inserts a new pending group; returns the existing row if another call won the race. */
  insertPending(jid: string, name: string): Promise<GroupRecord>;
  rename(id: string, name: string): Promise<void>;
  setStatus(id: string, status: GroupStatus): Promise<void>;
  touchActivity(id: string, at: Date): Promise<void>;
  assistantSettings(id: string): Promise<GroupAssistantSettings | null>;
  /** 7.1: records each active / paused group's status as the number is changed. */
  markForRelink(at: Date): Promise<number>;
  /** The status recorded at the last number change, if any (7.1). */
  relinkStatus(id: string): Promise<{ status: GroupStatus; at: Date } | null>;
  /** Back to its recorded status after the new number was added; the record is cleared. */
  readmit(id: string, status: GroupStatus): Promise<void>;
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

    async markForRelink(at) {
      let marked = 0;
      // One update per status keeps it a plain table update (no SQL function needed).
      for (const status of ["active", "paused"] as const) {
        const { data, error } = await db
          .from("groups")
          .update({ status_before_relink: status, relinked_at: at.toISOString() })
          .eq("status", status)
          .select("id");
        if (error) throw new Error(`groups update failed: ${error.message}`);
        marked += data.length;
      }
      return marked;
    },

    async relinkStatus(id) {
      const { data, error } = await db
        .from("groups")
        .select("status_before_relink, relinked_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`groups read failed: ${error.message}`);
      if (!data?.status_before_relink || !data.relinked_at) return null;
      return { status: data.status_before_relink as GroupStatus, at: new Date(data.relinked_at) };
    },

    readmit: (id, status) => update(id, { status, status_before_relink: null, relinked_at: null }),

    async assistantSettings(id) {
      const { data, error } = await db
        .from("groups")
        .select(
          "ai_enabled, allow_general_knowledge, daily_reply_cap, bot_instructions, reminder_permission",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`groups read failed: ${error.message}`);
      return data
        ? {
            aiEnabled: data.ai_enabled,
            allowGeneralKnowledge: data.allow_general_knowledge,
            dailyReplyCap: data.daily_reply_cap,
            botInstructions: data.bot_instructions,
            reminderPermission: data.reminder_permission as ReminderPermission,
          }
        : null;
    },
  };
}
