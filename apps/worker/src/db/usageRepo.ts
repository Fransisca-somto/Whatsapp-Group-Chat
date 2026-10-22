// AI usage per group per company-timezone day (ai_usage_daily, data-models.md §3.11).
// Writes go through record_ai_usage(), which adds atomically (§5.6).
import type { ServiceClient } from "./supabase.ts";

export type UsageEntry = {
  groupId: string;
  /** `YYYY-MM-DD` in the company timezone. */
  usageDate: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  replies: number;
};

export type UsageStore = {
  record(entry: UsageEntry): Promise<void>;
  /** Replies already sent in this group on this day (for the daily cap). */
  repliesOn(groupId: string, usageDate: string): Promise<number>;
};

export function createUsageRepo(db: ServiceClient): UsageStore {
  return {
    async record(entry) {
      const { error } = await db.rpc("record_ai_usage", {
        p_group_id: entry.groupId,
        p_usage_date: entry.usageDate,
        p_input_tokens: entry.inputTokens,
        p_output_tokens: entry.outputTokens,
        p_cost_usd: entry.costUsd,
        p_replies: entry.replies,
      });
      if (error) throw new Error(`record_ai_usage failed: ${error.message}`);
    },

    async repliesOn(groupId, usageDate) {
      const { data, error } = await db
        .from("ai_usage_daily")
        .select("reply_count")
        .eq("group_id", groupId)
        .eq("usage_date", usageDate)
        .maybeSingle();
      if (error) throw new Error(`ai_usage_daily read failed: ${error.message}`);
      return data?.reply_count ?? 0;
    },
  };
}
