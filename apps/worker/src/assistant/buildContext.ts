// Assembles what the AI sees (api-interfaces.md §5.2). Phase 3 sends all of the group's active
// training up to a size budget; Phase 4 replaces formatTraining's input with search_knowledge
// results in this same place.
import { jidDecode } from "baileys";

import { chatTimeInTz } from "@soft-agent-support/shared";

import type { TrainingEntry } from "../db/knowledgeRepo.ts";
import type { RecentMessage } from "../db/messagesRepo.ts";
import type { BotIdentity } from "../ingest/detectTag.ts";

/** ~3,000 tokens: plenty for a group's handbook, cheap per question. */
export const TRAINING_BUDGET_CHARS = 12_000;
const HISTORY_LINE_MAX = 500;

export type TrainingContext = {
  text: string;
  included: number;
  /** Titles left out because of the budget (oldest-edited first to go). */
  dropped: string[];
};

/** `entries` must be most recently edited first; older entries are dropped once over budget. */
export function formatTraining(
  entries: TrainingEntry[],
  budget = TRAINING_BUDGET_CHARS,
): TrainingContext {
  const blocks: string[] = [];
  const dropped: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const block = `### ${entry.title}\n${entry.content}`;
    if (used + block.length > budget) {
      dropped.push(entry.title);
      continue;
    }
    blocks.push(block);
    used += block.length + 2;
  }
  return { text: blocks.join("\n\n"), included: blocks.length, dropped };
}

const MEDIA_LABEL: Record<string, string> = {
  image: "(photo)",
  video: "(video)",
  audio: "(voice note)",
  document: "(document)",
  sticker: "(sticker)",
  other: "(message)",
};

/** `[Fri 9 Oct 3:05 PM] Ada: text`, in the company timezone. */
export function formatHistoryLine(
  message: RecentMessage,
  timezone: string,
  botName: string,
): string {
  const name = message.isFromBot
    ? botName
    : (message.senderName ?? message.senderPhoneE164 ?? "Someone");
  const raw = message.body?.trim() || MEDIA_LABEL[message.type] || "(message)";
  const text = raw.length > HISTORY_LINE_MAX ? `${raw.slice(0, HISTORY_LINE_MAX)}…` : raw;
  return `[${chatTimeInTz(message.sentAt, timezone)}] ${name}: ${text.replace(/\s+/g, " ")}`;
}

/** Removes "@2348000000000" / "@11112222" tokens that point at the bot, so the AI sees the question. */
export function stripBotMention(text: string, bot: BotIdentity): string {
  const ids = [bot.jid, bot.lid]
    .map((jid) => (jid ? jidDecode(jid)?.user : undefined))
    .filter((user): user is string => Boolean(user));
  let result = text;
  for (const id of ids) {
    result = result.replace(new RegExp(`@${id}\\b`, "g"), " ");
  }
  return result.replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
}
