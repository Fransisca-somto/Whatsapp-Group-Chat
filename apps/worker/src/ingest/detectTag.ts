// Tag detection (api-interfaces.md §4.2, Open Default D1): a real @mention of the bot (by phone
// JID or LID) or a reply to one of the bot's messages. Typing the bot's name does not count.
import { sameUser } from "../whatsapp/jids.ts";

export type BotIdentity = { jid: string | null; lid: string | null };

export function isBotUser(jid: string | null | undefined, bot: BotIdentity): boolean {
  return sameUser(jid, bot.jid) || sameUser(jid, bot.lid);
}

export function detectTag(
  message: { mentionedJids: string[]; quotedParticipantJid: string | null; isFromBot: boolean },
  bot: BotIdentity,
): boolean {
  if (message.isFromBot) return false; // the bot never tags itself
  return (
    message.mentionedJids.some((jid) => isBotUser(jid, bot)) ||
    isBotUser(message.quotedParticipantJid, bot)
  );
}
