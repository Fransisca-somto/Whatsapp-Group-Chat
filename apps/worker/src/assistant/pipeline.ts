// What happens to a tagged message (architecture.md §4, Workflow/Phases/05-Tagged-QA.md 3.5).
// "The AI proposes, code authorizes": the model only labels the message and writes answer text;
// every gate, permission and write below is decided by this code.
//
//   group gate (active, AI on; paused → silent, P6) → stale check (> 5 min, P4)
//   → rate gate (user per minute, group per day) → AI configured? → group trained?
//   → (a "yes"/"no" about the sender's reminder: confirmation flow) → AI configured? → trained?
//   → intent → code decision → (question: search this group; create_reminder: reminder flow)
//   → answer or fixed reply → format → send → status, usage, audit
//
// An untagged "yes"/"no" (handleReplyWord) only ever reaches the reminder confirmation check.
import type { WAMessage } from "baileys";

import {
  localDateInTz,
  localDateTimeInTz,
  replyWord,
  type HandledStatus,
  type InboundGroupMessage,
  type IntentResult,
  type Json,
} from "@soft-agent-support/shared";

import { EMBEDDING_MODEL, type EmbeddingsClient } from "../ai/embeddings.ts";
import { OpenRouterError, type ChatResult, type OpenRouterClient } from "../ai/openrouter.ts";
import type { AiSettingsStore, AssistantSettings } from "../db/aiSettingsRepo.ts";
import type { AuditStore } from "../db/auditRepo.ts";
import type { GroupRecord, GroupStore } from "../db/groupsRepo.ts";
import type { KnowledgeStore } from "../db/knowledgeRepo.ts";
import type { MessageStore, RecentMessage } from "../db/messagesRepo.ts";
import type { SearchQuery, SearchStore } from "../db/searchRepo.ts";
import type { UsageStore } from "../db/usageRepo.ts";
import type { ReminderFlow } from "../reminders/reminderFlow.ts";
import type { BotIdentity } from "../ingest/detectTag.ts";
import type { Logger } from "../logger.ts";
import { phoneFromJid } from "../whatsapp/jids.ts";
import type { SendQueue } from "../whatsapp/sendQueue.ts";
import { answerQuestion, replyToSmalltalk } from "./answerQuestion.ts";
import {
  formatHistoryLine,
  formatOlderMessages,
  formatTraining,
  keywordQuery,
  OLDER_MATCHES,
  stripBotMention,
  TRAINING_MATCHES,
} from "./buildContext.ts";
import { classifyIntent, type AiAccess } from "./classifyIntent.ts";
import { createGroupQueue, type GroupQueue } from "./groupQueue.ts";
import { createRateLimiter, type RateLimiter } from "./rateLimiter.ts";
import { TEMPLATES } from "./templates.ts";

/** P4: tags delivered after downtime are stored but not answered. */
export const STALE_AFTER_MS = 5 * 60_000;
const ANSWER_HISTORY = 15;
const INTENT_HISTORY = 5;

export type AssistantDeps = {
  groups: Pick<GroupStore, "assistantSettings">;
  messages: MessageStore;
  knowledge: KnowledgeStore;
  search: SearchStore;
  embeddings: EmbeddingsClient;
  usage: UsageStore;
  settings: AiSettingsStore;
  audit: AuditStore;
  ai: OpenRouterClient;
  reminders: ReminderFlow;
  send: SendQueue;
  getBot: () => BotIdentity;
  logger: Logger;
  limiter?: RateLimiter;
  queue?: GroupQueue;
  now?: () => number;
};

export type Assistant = {
  /** Queues the message behind earlier tags in the same group. */
  handle(message: InboundGroupMessage, group: GroupRecord, raw: WAMessage): void;
  /** Handles one message now (tests call this directly). */
  process(message: InboundGroupMessage, group: GroupRecord, raw: WAMessage): Promise<void>;
  /** An untagged "yes"/"no": queued like a tag, checked only against the sender's reminder. */
  handleReplyWord(message: InboundGroupMessage, group: GroupRecord, raw: WAMessage): void;
  processReplyWord(message: InboundGroupMessage, group: GroupRecord, raw: WAMessage): Promise<void>;
};

/** The result of one tagged message, written to the message row and the audit log. */
type Outcome = {
  status: HandledStatus;
  action: string;
  detail: Record<string, Json>;
};

export function createAssistant(deps: AssistantDeps): Assistant {
  const log = deps.logger.child({ module: "assistant" });
  const limiter = deps.limiter ?? createRateLimiter();
  const queue = deps.queue ?? createGroupQueue(deps.logger);
  const now = deps.now ?? Date.now;

  async function storeBotReply(
    group: GroupRecord,
    waMessageId: string,
    text: string,
    quotedId: string,
  ) {
    const bot = deps.getBot();
    await deps.messages
      .insertIfNew({
        groupId: group.id,
        waMessageId,
        senderJid: bot.jid ?? bot.lid ?? "bot",
        senderPhoneE164: phoneFromJid(bot.jid),
        senderName: null,
        isFromBot: true,
        type: "text",
        body: text,
        quotedWaMessageId: quotedId,
        mentionsBot: false,
        sentAt: new Date(now()),
        handledStatus: null,
      })
      .catch((error: unknown) => log.error({ err: error }, "could not store the bot's reply"));
  }

  async function process(message: InboundGroupMessage, group: GroupRecord, raw: WAMessage) {
    const started = now();
    const ctx = { groupId: group.id, waMessageId: message.waMessageId };

    // Group gate: paused groups keep storing but never answer (P6).
    if (group.status !== "active") return;
    const groupSettings = await deps.groups.assistantSettings(group.id);
    if (!groupSettings?.aiEnabled) return;

    const finish = async (outcome: Outcome) => {
      await deps.messages
        .setHandledStatus(group.id, message.waMessageId, outcome.status)
        .catch((error: unknown) =>
          log.error({ err: error, ...ctx }, "could not set handled status"),
        );
      await deps.audit
        .record({
          action: outcome.action,
          actorType: "member",
          actorRef: message.senderPhoneE164 ?? message.senderJid,
          groupId: group.id,
          sourceWaMessageId: message.waMessageId,
          detail: { ...outcome.detail, ms: now() - started },
        })
        .catch((error: unknown) => log.error({ err: error, ...ctx }, "audit write failed"));
      log.info(
        { ...ctx, action: outcome.action, status: outcome.status },
        "tagged message handled",
      );
    };

    // P4: a tag that waited out a disconnect is no longer a live question.
    if (now() - message.sentAt.getTime() > STALE_AFTER_MS) {
      await finish({
        status: "failed",
        action: "skipped_stale",
        detail: { ageSeconds: Math.round((now() - message.sentAt.getTime()) / 1000) },
      });
      return;
    }

    let settings: AssistantSettings;
    try {
      settings = await deps.settings.load();
    } catch (error) {
      log.error({ err: error, ...ctx }, "could not load assistant settings");
      await finish({
        status: "failed",
        action: "ai_failed",
        detail: { reason: "settings_unavailable" },
      });
      return;
    }
    const usageDate = localDateInTz(new Date(now()), settings.timezone);
    const calls: ChatResult[] = [];

    /** Sends one reply, stores it, counts it. Returns false if WhatsApp did not take it. */
    const reply = async (text: string, showTyping: boolean): Promise<string | null> => {
      try {
        const { waMessageId } = await deps.send.enqueue({
          groupJid: group.jid,
          text,
          quoted: raw,
          showTyping,
        });
        await storeBotReply(group, waMessageId, text, message.waMessageId);
        return waMessageId;
      } catch (error) {
        log.error({ err: error, ...ctx }, "reply was not sent");
        return null;
      } finally {
        await recordUsage(1);
      }
    };

    const recordUsage = async (replies: number) => {
      await deps.usage
        .record({
          groupId: group.id,
          usageDate,
          inputTokens: calls.reduce((sum, c) => sum + c.inputTokens, 0),
          outputTokens: calls.reduce((sum, c) => sum + c.outputTokens, 0),
          costUsd: calls.reduce((sum, c) => sum + c.costUsd, 0),
          replies,
        })
        .catch((error: unknown) => log.error({ err: error, ...ctx }, "could not record AI usage"));
      calls.length = 0; // never count the same call twice
    };

    const aiDetail = () => ({
      // The question's embedding is counted in tokens and cost, not listed as a chat model.
      models: [...new Set(calls.map((c) => c.model).filter((m) => m !== EMBEDDING_MODEL))],
      usedFallback: calls.some((c) => c.usedFallback),
      inputTokens: calls.reduce((sum, c) => sum + c.inputTokens, 0),
      outputTokens: calls.reduce((sum, c) => sum + c.outputTokens, 0),
      costUsd: Number(calls.reduce((sum, c) => sum + c.costUsd, 0).toFixed(6)),
    });

    /** Sends a reply and finishes; a failed send turns the outcome into `failed`. */
    const replyAndFinish = async (
      text: string,
      showTyping: boolean,
      outcome: Outcome,
      onSent?: (waMessageId: string) => Promise<void>,
    ) => {
      const detail = { ...outcome.detail, ...aiDetail() };
      const sentId = await reply(text, showTyping);
      if (sentId) {
        await onSent?.(sentId);
        await finish({ ...outcome, detail: { ...detail, replyWaMessageId: sentId } });
      } else {
        await finish({
          status: "failed",
          action: "send_failed",
          detail: { ...detail, intended: outcome.action },
        });
      }
    };

    // Rate gate: per user, then the group's daily cap.
    const userGate = limiter.checkUser(message.senderJid);
    if (userGate !== "ok") {
      if (userGate === "notify") await reply(TEMPLATES.rateLimited, false);
      await finish({
        status: "rate_limited",
        action: "rate_limited",
        detail: { scope: "user", notified: userGate === "notify" },
      });
      return;
    }
    const repliesToday = await deps.usage.repliesOn(group.id, usageDate).catch((error: unknown) => {
      log.error({ err: error, ...ctx }, "could not read today's reply count");
      return 0;
    });
    const groupGate = limiter.checkGroup(
      group.id,
      usageDate,
      repliesToday,
      groupSettings.dailyReplyCap,
    );
    if (groupGate !== "ok") {
      if (groupGate === "notify") await reply(TEMPLATES.dailyLimit, false);
      await finish({
        status: "rate_limited",
        action: "rate_limited",
        detail: { scope: "group", notified: groupGate === "notify", repliesToday },
      });
      return;
    }

    // Phase 6: "@bot yes" or a reply "yes" to the confirmation is the sender's answer, not a
    // question. Checked before the AI set-up gates: confirming needs no AI.
    const word = replyWord(message.body);
    if (word) {
      const answer = await deps.reminders.handleReplyWord({
        groupId: group.id,
        senderJid: message.senderJid,
        word,
        timeZone: settings.timezone,
      });
      if (answer) {
        await replyAndFinish(answer.text, false, answer, answer.onSent);
        return;
      }
    }

    // Set-up gates: the company's AI account, then this group's training.
    if (!settings.apiKey || !settings.chatModel) {
      await replyAndFinish(TEMPLATES.notConfigured, false, {
        status: "failed",
        action: "not_set_up",
        detail: { reason: "no_ai_settings" },
      });
      return;
    }
    const ai: AiAccess = {
      apiKey: settings.apiKey,
      chatModel: settings.chatModel,
      fallbackModel: settings.fallbackModel,
    };
    const entries = await deps.knowledge.listActive(group.id);
    if (entries.length === 0) {
      await replyAndFinish(TEMPLATES.notTrained, false, {
        status: "failed",
        action: "not_set_up",
        detail: { reason: "no_training" },
      });
      return;
    }

    const text = stripBotMention(message.body ?? "", deps.getBot());
    const recentMessages = await deps.messages.recent(group.id, message.sentAt, ANSWER_HISTORY);
    const history = recentMessages.map((m) =>
      formatHistoryLine(m, settings.timezone, settings.botName),
    );
    const askerName = message.senderName ?? "a team member";

    /**
     * Phase 4 retrieval, inside this group only. Training: everything if it fits the budget,
     * otherwise the best search matches (P8). History: the best matches older than the last-15
     * window (P9). The question is embedded only when a search is needed; if that fails, search
     * runs on keywords alone and the answer still goes out.
     */
    const retrieve = async (
      question: string,
      recent: RecentMessage[],
    ): Promise<{ training: string; older: string[]; detail: Record<string, Json> }> => {
      const all = formatTraining(entries);
      const trainingFits = all.dropped.length === 0;
      // Fewer than 15 recent messages means the whole history is already in the window.
      const hasOlder = recent.length === ANSWER_HISTORY;
      const query: SearchQuery = { embedding: null, keywords: keywordQuery(question) };
      let searchMode: "none" | "hybrid" | "keyword" = "none";

      if (!trainingFits || hasOlder) {
        try {
          const embedded = await deps.embeddings.embed(ai.apiKey, [question]);
          query.embedding = embedded.vectors[0] ?? null;
          calls.push({
            text: "",
            model: EMBEDDING_MODEL,
            usedFallback: false,
            truncated: false,
            inputTokens: embedded.inputTokens,
            outputTokens: 0,
            costUsd: embedded.costUsd,
          });
        } catch (error) {
          log.warn({ err: error, ...ctx }, "question embedding failed; keyword search only");
        }
        searchMode = query.embedding ? "hybrid" : query.keywords ? "keyword" : "none";
      }
      const canSearch = searchMode !== "none";

      let training = all.text;
      let trainingMode: "all" | "search" | "recent" = "all";
      let trainingMatches = 0;
      if (!trainingFits) {
        const matches = canSearch
          ? await deps.search
              .searchTraining(group.id, query, TRAINING_MATCHES)
              .catch((error: unknown) => {
                log.error({ err: error, ...ctx }, "training search failed");
                return [];
              })
          : [];
        if (matches.length > 0) {
          training = formatTraining(matches).text;
          trainingMode = "search";
          trainingMatches = matches.length;
        } else {
          // Nothing found: the most recently edited entries that fit, as before Phase 4.
          trainingMode = "recent";
          log.warn(
            { ...ctx, dropped: all.dropped },
            "training over the size budget and search found nothing; oldest-edited entries left out",
          );
        }
      }

      let older: string[] = [];
      const oldestRecent = recent[0];
      if (hasOlder && canSearch && oldestRecent) {
        // Ask for extra: matches inside the last-15 window are dropped.
        const matches = await deps.search
          .searchHistory(group.id, query, OLDER_MATCHES + ANSWER_HISTORY)
          .catch((error: unknown) => {
            log.error({ err: error, ...ctx }, "history search failed");
            return [];
          });
        older = formatOlderMessages(matches, oldestRecent.sentAt, settings.timezone);
      }

      return {
        training,
        older,
        detail: { searchMode, trainingMode, trainingMatches, historyMatches: older.length },
      };
    };

    try {
      let intent: IntentResult;
      if (text) {
        const classified = await classifyIntent(deps.ai, ai, {
          timezone: settings.timezone,
          nowLocal: localDateTimeInTz(new Date(now()), settings.timezone),
          text,
          recent: history.slice(-INTENT_HISTORY),
        });
        calls.push(classified.call);
        intent = classified.intent;
      } else {
        intent = { intent: "smalltalk" }; // a bare tag, or media with no caption
      }

      switch (intent.intent) {
        case "question": {
          const context = await retrieve(text, recentMessages);
          const answer = await answerQuestion(deps.ai, ai, {
            companyName: settings.companyName,
            botName: settings.botName,
            botInstructions: groupSettings.botInstructions,
            training: context.training,
            recent: history,
            older: context.older,
            question: text,
            askerName,
            allowGeneralKnowledge: groupSettings.allowGeneralKnowledge,
          });
          calls.push(answer.call);
          if (answer.kind === "dont_know") {
            await replyAndFinish(TEMPLATES.dontKnow, false, {
              status: "answered",
              action: "answered",
              detail: { intent: "question", kind: "dont_know", ...context.detail },
            });
          } else {
            if (answer.long) log.warn({ ...ctx, chars: answer.text.length }, "long reply");
            await replyAndFinish(answer.text, true, {
              status: "answered",
              action: "answered",
              detail: {
                intent: "question",
                kind: "answer",
                chars: answer.text.length,
                ...context.detail,
              },
            });
          }
          return;
        }
        case "smalltalk": {
          const small = await replyToSmalltalk(deps.ai, ai, {
            companyName: settings.companyName,
            botName: settings.botName,
            message: text || "(tagged the assistant with no text)",
          });
          calls.push(small.call);
          await replyAndFinish(small.text || TEMPLATES.refuse, true, {
            status: "answered",
            action: "answered",
            detail: { intent: "smalltalk", kind: "smalltalk" },
          });
          return;
        }
        case "create_reminder": {
          const answer = await deps.reminders.handleRequest({
            groupId: group.id,
            permission: groupSettings.reminderPermission,
            senderJid: message.senderJid,
            senderPhoneE164: message.senderPhoneE164,
            sourceWaMessageId: message.waMessageId,
            draft: intent.reminder,
            timeZone: settings.timezone,
          });
          await replyAndFinish(answer.text, false, answer, answer.onSent);
          return;
        }
        case "dashboard_only_action":
          await replyAndFinish(TEMPLATES.dashboardOnly, false, {
            status: "refused",
            action: "refused",
            detail: { intent: "dashboard_only_action", reason: intent.action },
          });
          return;
        case "refuse":
          await replyAndFinish(TEMPLATES.refuse, false, {
            status: "refused",
            action: "refused",
            detail: { intent: "refuse", reason: intent.reason },
          });
          return;
      }
    } catch (error) {
      if (!(error instanceof OpenRouterError)) throw error;
      calls.push({
        text: "",
        model: "",
        usedFallback: false,
        truncated: false,
        inputTokens: error.spent.inputTokens,
        outputTokens: error.spent.outputTokens,
        costUsd: error.spent.costUsd,
      });
      const sentId = await reply(TEMPLATES.aiUnavailable, false);
      await finish({
        status: "failed",
        action: "ai_failed",
        detail: { failure: error.failure, httpStatus: error.status, notified: Boolean(sentId) },
      });
    }
  }

  /** An untagged "yes"/"no": answered only when it is about the sender's own reminder. */
  async function processReplyWord(
    message: InboundGroupMessage,
    group: GroupRecord,
    raw: WAMessage,
  ) {
    const word = replyWord(message.body);
    if (!word || group.status !== "active") return;
    const groupSettings = await deps.groups.assistantSettings(group.id);
    if (!groupSettings?.aiEnabled) return;
    const settings = await deps.settings.load();
    const answer = await deps.reminders.handleReplyWord({
      groupId: group.id,
      senderJid: message.senderJid,
      word,
      timeZone: settings.timezone,
    });
    if (!answer) return; // ordinary chat

    let sentId: string | null = null;
    try {
      ({ waMessageId: sentId } = await deps.send.enqueue({
        groupJid: group.jid,
        text: answer.text,
        quoted: raw,
      }));
      await storeBotReply(group, sentId, answer.text, message.waMessageId);
      await answer.onSent?.(sentId);
    } catch (error) {
      log.error({ err: error, groupId: group.id }, "reminder reply was not sent");
    }
    await deps.audit
      .record({
        action: sentId ? answer.action : "send_failed",
        actorType: "member",
        actorRef: message.senderPhoneE164 ?? message.senderJid,
        groupId: group.id,
        sourceWaMessageId: message.waMessageId,
        detail: sentId
          ? { ...answer.detail, replyWaMessageId: sentId }
          : { ...answer.detail, intended: answer.action },
      })
      .catch((error: unknown) => log.error({ err: error }, "audit write failed"));
  }

  return {
    handleReplyWord(message, group, raw) {
      void queue.run(group.id, async () => {
        try {
          await processReplyWord(message, group, raw);
        } catch (error) {
          log.error(
            { err: error, groupId: group.id, waMessageId: message.waMessageId },
            "reply word failed",
          );
        }
      });
    },
    processReplyWord,
    handle(message, group, raw) {
      void queue.run(group.id, async () => {
        try {
          await process(message, group, raw);
        } catch (error) {
          log.error(
            { err: error, groupId: group.id, waMessageId: message.waMessageId },
            "tagged message failed",
          );
          await deps.messages
            .setHandledStatus(group.id, message.waMessageId, "failed")
            .catch(() => undefined);
        }
      });
    },
    process,
  };
}
