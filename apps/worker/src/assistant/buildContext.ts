// Assembles what the AI sees (api-interfaces.md §5.2). Training: all of the group's active
// entries when they fit the size budget, otherwise the best search matches (P8). History: the
// last 15 messages plus the best older matches from search (P9).
import { jidDecode } from "baileys";

import { chatTimeInTz } from "@soft-agent-support/shared";

import type { TrainingEntry } from "../db/knowledgeRepo.ts";
import type { RecentMessage } from "../db/messagesRepo.ts";
import type { HistoryMatch } from "../db/searchRepo.ts";
import type { BotIdentity } from "../ingest/detectTag.ts";

/** ~3,000 tokens: plenty for a group's handbook, cheap per question. */
export const TRAINING_BUDGET_CHARS = 12_000;
const HISTORY_LINE_MAX = 500;
/** P8: training entries sent when the whole training does not fit. */
export const TRAINING_MATCHES = 8;
/** P9: older messages added from search. */
export const OLDER_MATCHES = 8;
const KEYWORDS_MAX = 12;

export type TrainingContext = {
  text: string;
  included: number;
  /** Titles left out because of the budget (oldest-edited first to go). */
  dropped: string[];
};

/** `entries` in priority order (newest edit, or best match, first); later ones are dropped once over budget. */
export function formatTraining(
  entries: Pick<TrainingEntry, "title" | "content">[],
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

/** Words that say nothing about the topic; they would only add noise to keyword search. */
const STOP_WORDS = new Set(
  (
    "the and for are but not you all any can had has have her his him its our out was were " +
    "who whom whose what when where which why how did does doing done this that these those " +
    "there their them they then than with from about into over after before again also just " +
    "only some such very will would should could shall may might must been being here your " +
    "yours mine she one ones let lets get got please tell know thanks thank yes yeah okay " +
    "hello hey hii guys anyone someone something anything want need like"
  ).split(" "),
);

/**
 * Keyword text for `websearch_to_tsquery`: the question's meaningful words joined with `or`, so
 * any matching word counts (the database ranks messages matching more words higher). Plain
 * words only, so nothing in the question can act as search syntax. Empty when no word is left.
 */
export function keywordQuery(question: string): string {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const kept = [...new Set(words)].filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return kept.slice(0, KEYWORDS_MAX).join(" or ");
}

/**
 * P9: search matches older than the last-15 window (`before` = the oldest message in it), best
 * `limit` by score, shown oldest first in the same `[time] Name: text` form as recent chat.
 */
export function formatOlderMessages(
  matches: HistoryMatch[],
  before: string,
  timezone: string,
  limit = OLDER_MATCHES,
): string[] {
  const cutoff = Date.parse(before);
  return matches
    .filter((m) => Date.parse(m.sentAt) < cutoff)
    .slice(0, limit)
    .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt))
    .map((m) =>
      formatHistoryLine(
        {
          senderName: m.senderName,
          senderPhoneE164: m.senderPhoneE164,
          isFromBot: false,
          type: "text",
          body: m.body,
          sentAt: m.sentAt,
        },
        timezone,
        "",
      ),
    );
}
