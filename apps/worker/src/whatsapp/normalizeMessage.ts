// Raw Baileys message → the parts of InboundGroupMessage that need no network lookup.
// Pure, so every message shape is unit-tested. The sender's phone number is resolved separately
// (resolveSenderPhone) because mapping a LID to a phone number may need Baileys' key store.
import {
  getContentType,
  isJidGroup,
  normalizeMessageContent,
  type proto,
  type WAMessage,
} from "baileys";

import type { MessageType } from "@soft-agent-support/shared";

export type NormalizedMessage = {
  waMessageId: string;
  groupJid: string;
  senderJid: string;
  /** The other form of the sender's ID (phone JID when senderJid is a LID, or vice versa). */
  senderAltJid: string | null;
  senderName: string | null;
  type: MessageType;
  body: string | null;
  quotedWaMessageId: string | null;
  quotedParticipantJid: string | null;
  mentionedJids: string[];
  sentAt: Date;
  isFromBot: boolean;
};

/** Content types that are not conversation messages: never stored. */
const SKIPPED = new Set<string>([
  "protocolMessage", // deletes, edits, ephemeral settings
  "reactionMessage",
  "pollUpdateMessage",
  "encReactionMessage",
  "keepInChatMessage",
  "pinInChatMessage",
]);

const TYPE_MAP: Record<string, MessageType> = {
  conversation: "text",
  extendedTextMessage: "text",
  imageMessage: "image",
  videoMessage: "video",
  ptvMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker",
};

type WithContext = { contextInfo?: proto.IContextInfo | null };

/**
 * Returns null for anything that should not be stored: non-group chats, system stubs,
 * reactions, deletes, edits and similar protocol messages.
 * @param botJid The bot's own JID, used as the sender of its own messages.
 */
export function normalizeMessage(raw: WAMessage, botJid: string | null): NormalizedMessage | null {
  const key = raw.key;
  const groupJid = key.remoteJid;
  if (!groupJid || !isJidGroup(groupJid) || !key.id) return null;

  const content = normalizeMessageContent(raw.message);
  const contentType = getContentType(content);
  if (!content || !contentType || SKIPPED.has(contentType)) return null;

  const isFromBot = Boolean(key.fromMe);
  const senderJid = key.participant ?? (isFromBot ? botJid : null);
  if (!senderJid) return null;

  const inner = content[contentType] as (WithContext & Record<string, unknown>) | null | undefined;
  const context = inner && typeof inner === "object" ? (inner.contextInfo ?? null) : null;

  return {
    waMessageId: key.id,
    groupJid,
    senderJid,
    senderAltJid: key.participantAlt ?? null,
    senderName: raw.pushName ?? null,
    type: TYPE_MAP[contentType] ?? "other",
    body: extractBody(content),
    quotedWaMessageId: context?.stanzaId ?? null,
    quotedParticipantJid: context?.participant ?? null,
    mentionedJids: context?.mentionedJid ?? [],
    sentAt: toDate(raw.messageTimestamp),
    isFromBot,
  };
}

function extractBody(content: proto.IMessage): string | null {
  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    null;
  return text && text.trim() ? text : null;
}

/** Baileys timestamps are seconds, as a number or a protobuf Long. */
function toDate(timestamp: WAMessage["messageTimestamp"]): Date {
  if (timestamp === null || timestamp === undefined) return new Date();
  const seconds = typeof timestamp === "number" ? timestamp : Number(timestamp.toString());
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}
