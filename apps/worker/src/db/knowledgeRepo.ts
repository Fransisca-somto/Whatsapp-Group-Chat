// Per-group training (knowledge_entries, data-models.md §3.3, ADR-026). Every read is scoped to
// one group: there is deliberately no way to read another group's training from here.
import type { ServiceClient } from "./supabase.ts";

export type TrainingEntry = { title: string; content: string; updatedAt: string };

export type KnowledgeStore = {
  /** The group's active entries, most recently edited first. */
  listActive(groupId: string): Promise<TrainingEntry[]>;
};

export function createKnowledgeRepo(db: ServiceClient): KnowledgeStore {
  return {
    async listActive(groupId) {
      const { data, error } = await db
        .from("knowledge_entries")
        .select("title, content, updated_at")
        .eq("group_id", groupId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(`knowledge_entries read failed: ${error.message}`);
      return data.map((row) => ({
        title: row.title,
        content: row.content,
        updatedAt: row.updated_at,
      }));
    },
  };
}
