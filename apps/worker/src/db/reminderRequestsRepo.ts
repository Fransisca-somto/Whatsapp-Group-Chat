// pending_reminder_requests (data-models.md §3.8): reminders waiting for the requester's "yes".
// Requester JIDs are stored normalised (no device suffix), so "yes" from any of their devices
// matches.
import type { ServiceClient } from "./supabase.ts";

export type ReminderRequest = {
  id: string;
  groupId: string;
  requesterJid: string;
  body: string;
  dueAt: Date;
  expiresAt: Date;
};

export type NewReminderRequest = {
  groupId: string;
  requesterJid: string;
  requesterPhoneE164: string | null;
  sourceWaMessageId: string;
  body: string;
  dueAt: Date;
  expiresAt: Date;
};

export type ReminderRequestStore = {
  /** Supersedes this person's awaiting request in the group, then stores the new one. */
  create(request: NewReminderRequest): Promise<string>;
  setConfirmationMessage(id: string, waMessageId: string): Promise<void>;
  /** This person's request in this group that is still awaiting and not expired. */
  findAwaiting(groupId: string, requesterJid: string, now: Date): Promise<ReminderRequest | null>;
  /** True if this person had a request here that expired after `since` (P23). */
  expiredSince(groupId: string, requesterJid: string, since: Date, now: Date): Promise<boolean>;
  /** confirm_reminder_request(): the new reminder's id, or null if nothing was confirmed. */
  confirm(id: string, requesterJid: string): Promise<string | null>;
  /** awaiting → declined; false if it was no longer awaiting. */
  decline(id: string): Promise<boolean>;
  /** awaiting requests past their expiry → expired. Returns them for the audit log. */
  expireOverdue(now: Date): Promise<ReminderRequest[]>;
};

const COLUMNS = "id, group_id, requester_jid, draft_body, draft_due_at, expires_at";

type Row = {
  id: string;
  group_id: string;
  requester_jid: string;
  draft_body: string;
  draft_due_at: string;
  expires_at: string;
};

const toRequest = (row: Row): ReminderRequest => ({
  id: row.id,
  groupId: row.group_id,
  requesterJid: row.requester_jid,
  body: row.draft_body,
  dueAt: new Date(row.draft_due_at),
  expiresAt: new Date(row.expires_at),
});

export function createReminderRequestsRepo(db: ServiceClient): ReminderRequestStore {
  return {
    async create(request) {
      const { error: supersedeError } = await db
        .from("pending_reminder_requests")
        .update({ status: "superseded" })
        .eq("group_id", request.groupId)
        .eq("requester_jid", request.requesterJid)
        .eq("status", "awaiting");
      if (supersedeError) {
        throw new Error(`pending_reminder_requests update failed: ${supersedeError.message}`);
      }
      const { data, error } = await db
        .from("pending_reminder_requests")
        .insert({
          group_id: request.groupId,
          requester_jid: request.requesterJid,
          requester_phone_e164: request.requesterPhoneE164,
          source_wa_message_id: request.sourceWaMessageId,
          draft_body: request.body,
          draft_due_at: request.dueAt.toISOString(),
          expires_at: request.expiresAt.toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(`pending_reminder_requests insert failed: ${error.message}`);
      return data.id;
    },

    async setConfirmationMessage(id, waMessageId) {
      const { error } = await db
        .from("pending_reminder_requests")
        .update({ confirmation_wa_message_id: waMessageId })
        .eq("id", id);
      if (error) throw new Error(`pending_reminder_requests update failed: ${error.message}`);
    },

    async findAwaiting(groupId, requesterJid, now) {
      const { data, error } = await db
        .from("pending_reminder_requests")
        .select(COLUMNS)
        .eq("group_id", groupId)
        .eq("requester_jid", requesterJid)
        .eq("status", "awaiting")
        .gt("expires_at", now.toISOString())
        .maybeSingle();
      if (error) throw new Error(`pending_reminder_requests read failed: ${error.message}`);
      return data ? toRequest(data) : null;
    },

    async expiredSince(groupId, requesterJid, since, now) {
      // Either already marked expired, or still awaiting but past its time (a slow tick).
      const { data, error } = await db
        .from("pending_reminder_requests")
        .select("id")
        .eq("group_id", groupId)
        .eq("requester_jid", requesterJid)
        .in("status", ["awaiting", "expired"])
        .gt("expires_at", since.toISOString())
        .lte("expires_at", now.toISOString())
        .limit(1);
      if (error) throw new Error(`pending_reminder_requests read failed: ${error.message}`);
      return data.length > 0;
    },

    async confirm(id, requesterJid) {
      const { data, error } = await db.rpc("confirm_reminder_request", {
        p_request_id: id,
        p_requester_jid: requesterJid,
      });
      if (error) throw new Error(`confirm_reminder_request failed: ${error.message}`);
      return data || null;
    },

    async decline(id) {
      const { data, error } = await db
        .from("pending_reminder_requests")
        .update({ status: "declined" })
        .eq("id", id)
        .eq("status", "awaiting")
        .select("id");
      if (error) throw new Error(`pending_reminder_requests update failed: ${error.message}`);
      return data.length > 0;
    },

    async expireOverdue(now) {
      const { data, error } = await db
        .from("pending_reminder_requests")
        .update({ status: "expired" })
        .eq("status", "awaiting")
        .lte("expires_at", now.toISOString())
        .select(COLUMNS);
      if (error) throw new Error(`pending_reminder_requests update failed: ${error.message}`);
      return data.map(toRequest);
    },
  };
}
