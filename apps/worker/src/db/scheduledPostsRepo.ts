// scheduled_posts for the scheduler (data-models.md §3.9, api-interfaces.md §8.1, ADR-034).
// Every change after a claim matches the claim token and `sending`, so a post can only be
// finished by the tick that claimed it.
import type { ScheduledPostKind, TablesUpdate } from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

type PostUpdate = TablesUpdate<"scheduled_posts">;

const UNIQUE_VIOLATION = "23505";
const POST_COLUMNS =
  "id, group_id, kind, body, due_at, recurrence_rule, parent_post_id, created_by_user_id";

export type ScheduledPost = {
  id: string;
  groupId: string;
  kind: ScheduledPostKind;
  body: string;
  dueAt: Date;
  recurrenceRule: string | null;
  parentPostId: string | null;
  createdByUserId: string | null;
};

export type ScheduledPostStore = {
  /** Leftover `sending` rows (a stopped session) → `delivery_uncertain`. Returns them. */
  markLeftoverSendingUncertain(reason: string): Promise<ScheduledPost[]>;
  /** `scheduled` posts of active groups due before `cutoff` → `skipped_late`. Returns them. */
  skipLate(cutoff: Date): Promise<ScheduledPost[]>;
  /** Due posts of active groups → `sending` with this token (claim_due_posts). */
  claim(token: string, limit: number): Promise<ScheduledPost[]>;
  /** WhatsApp group JIDs by group id. */
  groupJids(groupIds: string[]): Promise<Map<string, string>>;
  markSent(id: string, token: string, waMessageId: string, sentLate: boolean): Promise<void>;
  markFailed(id: string, token: string, error: string): Promise<void>;
  markUncertain(id: string, token: string, reason: string): Promise<void>;
  /** Nothing reached WhatsApp: back to `scheduled` for the next tick. */
  release(id: string, token: string): Promise<void>;
  /** The next post of a series; false if the series already has one waiting. */
  insertNext(post: ScheduledPost, dueAt: Date): Promise<boolean>;
};

type Row = {
  id: string;
  group_id: string;
  kind: string;
  body: string;
  due_at: string;
  recurrence_rule: string | null;
  parent_post_id: string | null;
  created_by_user_id: string | null;
};

function toPost(row: Row): ScheduledPost {
  return {
    id: row.id,
    groupId: row.group_id,
    kind: row.kind as ScheduledPostKind,
    body: row.body,
    dueAt: new Date(row.due_at),
    recurrenceRule: row.recurrence_rule,
    parentPostId: row.parent_post_id,
    createdByUserId: row.created_by_user_id,
  };
}

export function createScheduledPostsRepo(db: ServiceClient): ScheduledPostStore {
  async function finish(id: string, token: string, values: PostUpdate) {
    const { error } = await db
      .from("scheduled_posts")
      .update(values)
      .eq("id", id)
      .eq("claim_token", token)
      .eq("status", "sending");
    if (error) throw new Error(`scheduled_posts update failed: ${error.message}`);
  }

  return {
    async markLeftoverSendingUncertain(reason) {
      const { data, error } = await db
        .from("scheduled_posts")
        .update({ status: "delivery_uncertain", last_error: reason })
        .eq("status", "sending")
        .select(POST_COLUMNS);
      if (error) throw new Error(`scheduled_posts update failed: ${error.message}`);
      return data.map(toPost);
    },

    async skipLate(cutoff) {
      const { data: groups, error: groupsError } = await db
        .from("groups")
        .select("id")
        .eq("status", "active");
      if (groupsError) throw new Error(`groups read failed: ${groupsError.message}`);
      if (groups.length === 0) return [];
      const { data, error } = await db
        .from("scheduled_posts")
        .update({ status: "skipped_late" })
        .eq("status", "scheduled")
        .lt("due_at", cutoff.toISOString())
        .in(
          "group_id",
          groups.map((g) => g.id),
        )
        .select(POST_COLUMNS);
      if (error) throw new Error(`scheduled_posts update failed: ${error.message}`);
      return data.map(toPost);
    },

    async claim(token, limit) {
      const { data, error } = await db.rpc("claim_due_posts", {
        p_claim_token: token,
        p_limit: limit,
      });
      if (error) throw new Error(`claim_due_posts failed: ${error.message}`);
      return data.map(toPost);
    },

    async groupJids(groupIds) {
      if (groupIds.length === 0) return new Map();
      const { data, error } = await db.from("groups").select("id, wa_group_jid").in("id", groupIds);
      if (error) throw new Error(`groups read failed: ${error.message}`);
      return new Map(data.map((g) => [g.id, g.wa_group_jid]));
    },

    markSent: (id, token, waMessageId, sentLate) =>
      finish(id, token, {
        status: "sent",
        sent_at: new Date().toISOString(),
        wa_message_id: waMessageId,
        sent_late: sentLate,
        last_error: null,
      }),

    markFailed: (id, token, error) =>
      finish(id, token, { status: "failed", last_error: error.slice(0, 500) }),

    markUncertain: (id, token, reason) =>
      finish(id, token, { status: "delivery_uncertain", last_error: reason }),

    release: (id, token) =>
      finish(id, token, { status: "scheduled", claim_token: null, claimed_at: null }),

    async insertNext(post, dueAt) {
      const { error } = await db.from("scheduled_posts").insert({
        group_id: post.groupId,
        kind: post.kind,
        body: post.body,
        due_at: dueAt.toISOString(),
        recurrence_rule: post.recurrenceRule,
        parent_post_id: post.parentPostId ?? post.id,
        created_via: "dashboard",
        created_by_user_id: post.createdByUserId,
      });
      if (error?.code === UNIQUE_VIOLATION) return false;
      if (error) throw new Error(`scheduled_posts insert failed: ${error.message}`);
      return true;
    },
  };
}
