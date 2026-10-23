// One inbound group message (architecture.md §4, steps 1–3 for Phase 2):
//   group gate (cached status; only active and paused groups are stored) → store once (dedupe on
//   the WhatsApp message ID) → tag gate. Tagged messages are handed to onTagged (the assistant
//   pipeline, assistant/pipeline.ts) with the raw message so the reply can quote it.
import type { WAMessage } from "baileys";

import {
  inboundGroupMessageSchema,
  storesMessages,
  type InboundGroupMessage,
} from "@soft-agent-support/shared";

import type { GroupRecord, GroupStore } from "../db/groupsRepo.ts";
import type { MessageStore } from "../db/messagesRepo.ts";
import type { Logger } from "../logger.ts";
import { phoneFromJid, resolveSenderPhone, type LidToPhoneLookup } from "../whatsapp/jids.ts";
import { normalizeMessage } from "../whatsapp/normalizeMessage.ts";
import { detectTag, type BotIdentity } from "./detectTag.ts";
import type { GroupDirectory } from "./groupDirectory.ts";

export type TaggedHandler = (
  message: InboundGroupMessage,
  group: GroupRecord,
  raw: WAMessage,
) => void;

const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

export function createInboundHandler(deps: {
  directory: GroupDirectory;
  messages: MessageStore;
  groups: Pick<GroupStore, "touchActivity">;
  lookupPhone: LidToPhoneLookup;
  getBot: () => BotIdentity;
  /** Called for a message from a group the database does not know yet. */
  onUnknownGroup: (jid: string) => Promise<GroupRecord | null>;
  onTagged: TaggedHandler;
  logger: Logger;
  now?: () => number;
}): { handle(raw: WAMessage): Promise<void> } {
  const { directory, messages, groups, getBot, onTagged, now = Date.now } = deps;
  const log = deps.logger.child({ module: "ingest" });
  const lastActivityWrite = new Map<string, number>();

  async function touchActivity(group: GroupRecord, at: Date) {
    const last = lastActivityWrite.get(group.id);
    if (last !== undefined && now() - last < ACTIVITY_WRITE_INTERVAL_MS) return;
    lastActivityWrite.set(group.id, now());
    await groups.touchActivity(group.id, at).catch((error: unknown) => {
      log.warn({ err: error }, "could not update group activity");
    });
  }

  return {
    async handle(raw) {
      const bot = getBot();
      const normalized = normalizeMessage(raw, bot.jid);
      if (!normalized) return;

      const group =
        (await directory.get(normalized.groupJid)) ??
        (await deps.onUnknownGroup(normalized.groupJid));
      if (!group || !storesMessages(group.status)) return; // pending/removed/archived: store nothing

      const senderPhoneE164 = normalized.isFromBot
        ? phoneFromJid(bot.jid)
        : await resolveSenderPhone(normalized.senderJid, normalized.senderAltJid, deps.lookupPhone);

      const parsed = inboundGroupMessageSchema.safeParse({
        waMessageId: normalized.waMessageId,
        groupJid: normalized.groupJid,
        senderJid: normalized.senderJid,
        senderPhoneE164,
        senderName: normalized.senderName,
        type: normalized.type,
        body: normalized.body,
        quotedWaMessageId: normalized.quotedWaMessageId,
        quotedParticipantJid: normalized.quotedParticipantJid,
        mentionedJids: normalized.mentionedJids,
        sentAt: normalized.sentAt,
        isFromBot: normalized.isFromBot,
      });
      if (!parsed.success) {
        log.warn(
          { issues: parsed.error.issues, waMessageId: normalized.waMessageId },
          "invalid message skipped",
        );
        return;
      }
      const message = parsed.data;
      const tagged = detectTag(message, bot);

      const inserted = await messages.insertIfNew({
        groupId: group.id,
        waMessageId: message.waMessageId,
        senderJid: message.senderJid,
        senderPhoneE164: message.senderPhoneE164,
        senderName: message.senderName,
        isFromBot: message.isFromBot,
        type: message.type,
        body: message.body,
        quotedWaMessageId: message.quotedWaMessageId,
        mentionsBot: tagged,
        sentAt: message.sentAt,
        handledStatus: tagged ? "received" : null,
      });
      if (!inserted) return; // already stored: never handle a message twice

      await touchActivity(group, message.sentAt);
      if (tagged) onTagged(message, group, raw);
    },
  };
}
