// A group message as the worker sees it after normalising Baileys' raw shape
// (api-interfaces.md §4.2). Parsed with zod at the boundary before anything is stored.
import { z } from "zod";

import { messageTypeSchema } from "./enums.ts";
import { E164_REGEX } from "./phone.ts";

export const inboundGroupMessageSchema = z.object({
  waMessageId: z.string().min(1),
  groupJid: z.string().endsWith("@g.us"),
  senderJid: z.string().min(1),
  /** null if only a LID is known and it cannot be mapped to a phone number (ADR-006). */
  senderPhoneE164: z.string().regex(E164_REGEX).nullable(),
  senderName: z.string().nullable(),
  type: messageTypeSchema,
  /** Text or caption; null for media without a caption. */
  body: z.string().nullable(),
  quotedWaMessageId: z.string().nullable(),
  /** Sender of the quoted message (JID or LID), used to detect replies to the bot. */
  quotedParticipantJid: z.string().nullable(),
  mentionedJids: z.array(z.string()),
  sentAt: z.date(),
  isFromBot: z.boolean(),
});
export type InboundGroupMessage = z.infer<typeof inboundGroupMessageSchema>;
