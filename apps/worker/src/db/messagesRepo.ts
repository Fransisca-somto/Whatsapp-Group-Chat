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

export type MessageStore = {
  /** True if stored now; false if this WhatsApp message was already stored. */
  insertIfNew(message: NewGroupMessage): Promise<boolean>;
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
  };
}
