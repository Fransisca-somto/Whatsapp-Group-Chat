// group_messages access (data-models.md §3.7). The (group_id, wa_message_id) unique key is the
// dedupe: a message delivered twice is inserted once.
import type { HandledStatus, MessageType } from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

export type NewGroupMessage = {
  groupId: string;
  waMessageId: string;
  senderJid: string;
  senderPhoneE164: string | null;
  senderName: string | null;
  isFromBot: boolean;
  type: MessageType;
  body: string | null;
  quotedWaMessageId: string | null;
  mentionsBot: boolean;
  sentAt: Date;
  handledStatus: HandledStatus | null;
};

/** A stored message as the assistant reads it for context. */
export type RecentMessage = {
  senderName: string | null;
  senderPhoneE164: string | null;
  isFromBot: boolean;
  type: MessageType;
  body: string | null;
  sentAt: string;
};

export type MessageStore = {
  /** True if stored now; false if this WhatsApp message was already stored. */
  insertIfNew(message: NewGroupMessage): Promise<boolean>;
  /** The group's last `limit` messages sent before `before`, oldest first. */
  recent(groupId: string, before: Date, limit: number): Promise<RecentMessage[]>;
  /** Records what the assistant did with a tagged message. */
  setHandledStatus(groupId: string, waMessageId: string, status: HandledStatus): Promise<void>;
};

export function createMessagesRepo(db: ServiceClient): MessageStore {
  return {
    async insertIfNew(m) {
      const { data, error } = await db
        .from("group_messages")
        .upsert(
          {
            group_id: m.groupId,
            wa_message_id: m.waMessageId,
            sender_jid: m.senderJid,
            sender_phone_e164: m.senderPhoneE164,
            sender_name: m.senderName,
            is_from_bot: m.isFromBot,
            message_type: m.type,
            body: m.body,
            quoted_wa_message_id: m.quotedWaMessageId,
            mentions_bot: m.mentionsBot,
            sent_at: m.sentAt.toISOString(),
            handled_status: m.handledStatus,
          },
          { onConflict: "group_id,wa_message_id", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw new Error(`group_messages insert failed: ${error.message}`);
      return data.length > 0;
    },

    async recent(groupId, before, limit) {
      const { data, error } = await db
        .from("group_messages")
        .select("sender_name, sender_phone_e164, is_from_bot, message_type, body, sent_at")
        .eq("group_id", groupId)
        .lt("sent_at", before.toISOString())
        .order("sent_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`group_messages read failed: ${error.message}`);
      return data.reverse().map((row) => ({
        senderName: row.sender_name,
        senderPhoneE164: row.sender_phone_e164,
        isFromBot: row.is_from_bot,
        type: row.message_type as MessageType,
        body: row.body,
        sentAt: row.sent_at,
      }));
    },

    async setHandledStatus(groupId, waMessageId, status) {
      const { error } = await db
        .from("group_messages")
        .update({ handled_status: status })
        .eq("group_id", groupId)
        .eq("wa_message_id", waMessageId);
      if (error) throw new Error(`group_messages update failed: ${error.message}`);
    },
  };
}
