// Rows waiting to be indexed, and the results of indexing (data-models.md §3.3, §3.7; ADR-031).
// Only the leader runs the indexing job, so rows are read, not locked.
import type { MessageType } from "@soft-agent-support/shared";

import { toVectorLiteral } from "../ai/embeddings.ts";
import type { ServiceClient } from "./supabase.ts";

export type PendingTraining = {
  id: string;
  groupId: string;
  title: string;
  content: string;
  attempts: number;
  /** Saving checks this, so an entry edited while it was being indexed stays `pending`. */
  updatedAt: string;
};

export type PendingMessage = {
  id: string;
  groupId: string;
  isFromBot: boolean;
  type: MessageType;
  body: string | null;
  attempts: number;
};

export type EmbeddingTable = "knowledge_entries" | "group_messages";

export type EmbeddingsStore = {
  /** Oldest edits first. */
  pendingTraining(limit: number): Promise<PendingTraining[]>;
  /** Newest first, so recent conversations become searchable before the backlog. */
  pendingMessages(limit: number): Promise<PendingMessage[]>;
  saveTraining(entry: PendingTraining, embedding: number[]): Promise<void>;
  saveMessage(id: string, embedding: number[]): Promise<void>;
  markSkipped(messageIds: string[]): Promise<void>;
  /** Counts a failed attempt; at `maxAttempts` the row becomes `failed`. */
  recordFailure(
    table: EmbeddingTable,
    rows: { id: string; attempts: number }[],
    maxAttempts: number,
  ): Promise<void>;
};

export function createEmbeddingsRepo(db: ServiceClient): EmbeddingsStore {
  return {
    async pendingTraining(limit) {
      const { data, error } = await db
        .from("knowledge_entries")
        .select("id, group_id, title, content, embedding_attempts, updated_at")
        .eq("embedding_status", "pending")
        .order("updated_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`knowledge_entries read failed: ${error.message}`);
      return data.map((row) => ({
        id: row.id,
        groupId: row.group_id,
        title: row.title,
        content: row.content,
        attempts: row.embedding_attempts,
        updatedAt: row.updated_at,
      }));
    },

    async pendingMessages(limit) {
      const { data, error } = await db
        .from("group_messages")
        .select("id, group_id, is_from_bot, message_type, body, embedding_attempts")
        .eq("embedding_status", "pending")
        .order("sent_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`group_messages read failed: ${error.message}`);
      return data.map((row) => ({
        id: row.id,
        groupId: row.group_id,
        isFromBot: row.is_from_bot,
        type: row.message_type as MessageType,
        body: row.body,
        attempts: row.embedding_attempts,
      }));
    },

    async saveTraining(entry, embedding) {
      const { error } = await db
        .from("knowledge_entries")
        .update({ embedding: toVectorLiteral(embedding), embedding_status: "done" })
        .eq("id", entry.id)
        .eq("updated_at", entry.updatedAt);
      if (error) throw new Error(`knowledge_entries update failed: ${error.message}`);
    },

    async saveMessage(id, embedding) {
      const { error } = await db
        .from("group_messages")
        .update({ embedding: toVectorLiteral(embedding), embedding_status: "done" })
        .eq("id", id);
      if (error) throw new Error(`group_messages update failed: ${error.message}`);
    },

    async markSkipped(messageIds) {
      if (messageIds.length === 0) return;
      const { error } = await db
        .from("group_messages")
        .update({ embedding_status: "skipped" })
        .in("id", messageIds);
      if (error) throw new Error(`group_messages update failed: ${error.message}`);
    },

    async recordFailure(table, rows, maxAttempts) {
      // Rows with the same new count share one update.
      const byCount = new Map<number, string[]>();
      for (const row of rows) {
        const next = row.attempts + 1;
        byCount.set(next, [...(byCount.get(next) ?? []), row.id]);
      }
      for (const [attempts, ids] of byCount) {
        const update =
          attempts >= maxAttempts
            ? { embedding_attempts: attempts, embedding_status: "failed" }
            : { embedding_attempts: attempts };
        const { error } =
          table === "knowledge_entries"
            ? await db.from("knowledge_entries").update(update).in("id", ids)
            : await db.from("group_messages").update(update).in("id", ids);
        if (error) throw new Error(`${table} update failed: ${error.message}`);
      }
    },
  };
}
