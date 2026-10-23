// What happens to a tagged message (architecture.md §4, Workflow/Phases/05-Tagged-QA.md 3.5).
// "The AI proposes, code authorizes": the model only labels the message and writes answer text;
// every gate, permission and write below is decided by this code.
//
//   group gate (active, AI on; paused → silent, P6) → stale check (> 5 min, P4)
//   → rate gate (user per minute, group per day) → AI configured? → group trained?
//   → intent → code decision → answer or fixed reply → format → send → status, usage, audit
import type { WAMessage } from "baileys";

import {
  localDateInTz,
  localDateTimeInTz,
  type HandledStatus,
  type InboundGroupMessage,
  type IntentResult,
  type Json,
} from "@soft-agent-support/shared";

import { OpenRouterError, type ChatResult, type OpenRouterClient } from "../ai/openrouter.ts";
import type { AiSettingsStore, AssistantSettings } from "../db/aiSettingsRepo.ts";
import type { AuditStore } from "../db/auditRepo.ts";
import type { GroupRecord, GroupStore } from "../db/groupsRepo.ts";
import type { KnowledgeStore } from "../db/knowledgeRepo.ts";
import type { MessageStore } from "../db/messagesRepo.ts";
import type { UsageStore } from "../db/usageRepo.ts";
import type { BotIdentity } from "../ingest/detectTag.ts";
import type { Logger } from "../logger.ts";
import { phoneFromJid } from "../whatsapp/jids.ts";
import type { SendQueue } from "../whatsapp/sendQueue.ts";
import { answerQuestion, replyToSmalltalk } from "./answerQuestion.ts";
import { formatHistoryLine, formatTraining, stripBotMention } from "./buildContext.ts";
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
  usage: UsageStore;
  settings: AiSettingsStore;
  audit: AuditStore;
  ai: OpenRouterClient;
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
      models: [...new Set(calls.map((c) => c.model))],
      usedFallback: calls.some((c) => c.usedFallback),
      inputTokens: calls.reduce((sum, c) => sum + c.inputTokens, 0),
      outputTokens: calls.reduce((sum, c) => sum + c.outputTokens, 0),
      costUsd: Number(calls.reduce((sum, c) => sum + c.costUsd, 0).toFixed(6)),
    });

    /** Sends a reply and finishes; a failed send turns the outcome into `failed`. */
    const replyAndFinish = async (text: string, showTyping: boolean, outcome: Outcome) => {
      const detail = { ...outcome.detail, ...aiDetail() };
      const sentId = await reply(text, showTyping);
      if (sentId) {
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
    const history = (await deps.messages.recent(group.id, message.sentAt, ANSWER_HISTORY)).map(
      (m) => formatHistoryLine(m, settings.timezone, settings.botName),
    );
    const askerName = message.senderName ?? "a team member";

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
          const training = formatTraining(entries);
          if (training.dropped.length > 0) {
            log.warn(
              { ...ctx, dropped: training.dropped },
              "training over the size budget; oldest-edited entries left out",
            );
          }
          const answer = await answerQuestion(deps.ai, ai, {
            companyName: settings.companyName,
            botName: settings.botName,
            botInstructions: groupSettings.botInstructions,
            training: training.text,
            recent: history,
            question: text,
            askerName,
            allowGeneralKnowledge: groupSettings.allowGeneralKnowledge,
          });
          calls.push(answer.call);
          if (answer.kind === "dont_know") {
            await replyAndFinish(TEMPLATES.dontKnow, false, {
              status: "answered",
              action: "answered",
              detail: { intent: "question", kind: "dont_know" },
            });
          } else {
            if (answer.long) log.warn({ ...ctx, chars: answer.text.length }, "long reply");
            await replyAndFinish(answer.text, true, {
              status: "answered",
              action: "answered",
              detail: { intent: "question", kind: "answer", chars: answer.text.length },
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
        case "create_reminder":
          await replyAndFinish(TEMPLATES.remindersNotYet, false, {
            status: "refused",
            action: "refused",
            detail: { intent: "create_reminder", reason: "reminders_not_available" },
          });
          return;
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

  return {
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
