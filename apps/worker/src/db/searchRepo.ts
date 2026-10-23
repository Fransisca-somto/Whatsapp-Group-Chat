// Hybrid search (meaning + keyword, data-models.md §5.1–5.2, ADR-004). Both functions take the
// group as a required argument, and so does every method here: there is no way to search
// without naming the asking group, so one group can never see another's history or training.
import { toVectorLiteral } from "../ai/embeddings.ts";
import type { ServiceClient } from "./supabase.ts";

export type SearchQuery = {
  /** The question's embedding; null searches by keyword only. */
  embedding: number[] | null;
  /** `websearch_to_tsquery` text, e.g. "weekly or reports or deadline". */
  keywords: string;
};

export type HistoryMatch = {
  waMessageId: string;
  senderName: string | null;
  senderPhoneE164: string | null;
  body: string;
  sentAt: string;
  score: number;
};

export type TrainingMatch = { title: string; content: string; score: number };

export type SearchStore = {
  /** Staff messages only (the bot's replies are left out), best match first. */
  searchHistory(groupId: string, query: SearchQuery, limit: number): Promise<HistoryMatch[]>;
  /** Active training entries, best match first. */
  searchTraining(groupId: string, query: SearchQuery, limit: number): Promise<TrainingMatch[]>;
};

/** SQL null skips the meaning branch; the generated type does not show that the argument may be null. */
const vectorArg = (embedding: number[] | null) =>
  (embedding ? toVectorLiteral(embedding) : null) as string;

export function createSearchRepo(db: ServiceClient): SearchStore {
  return {
    async searchHistory(groupId, query, limit) {
      const { data, error } = await db.rpc("search_group_history", {
        p_group_id: groupId,
        p_query_embedding: vectorArg(query.embedding),
        p_query_text: query.keywords,
        p_limit: limit,
      });
      if (error) throw new Error(`search_group_history failed: ${error.message}`);
      return data.map((row) => ({
        waMessageId: row.wa_message_id,
        senderName: row.sender_name,
        senderPhoneE164: row.sender_phone_e164,
        body: row.body,
        sentAt: row.sent_at,
        score: row.score,
      }));
    },

    async searchTraining(groupId, query, limit) {
      const { data, error } = await db.rpc("search_knowledge", {
        p_group_id: groupId,
        p_query_embedding: vectorArg(query.embedding),
        p_query_text: query.keywords,
        p_limit: limit,
      });
      if (error) throw new Error(`search_knowledge failed: ${error.message}`);
      return data.map((row) => ({ title: row.title, content: row.content, score: row.score }));
    },
  };
}
