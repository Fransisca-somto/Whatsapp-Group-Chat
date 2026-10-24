// Reminders created by tagging the bot (api-interfaces.md §5.3, Workflow/Phases/08-Tag-Reminders.md
// 6.3–6.5, ADR-035). "The AI proposes, code authorizes": the AI only read the request; this module
// decides who may set it, whether the time is acceptable, and what a "yes" means.
//
//   request  → permission → draft check → awaiting request (2 min) → "Reply yes to confirm…"
//   "yes"    → confirm_reminder_request() (one step) → "Done. Reminder set for …"
//   "no"     → declined → "Okay, cancelled."
//   late yes → "That request has expired…" (P23)
//
// Only the requester's own "yes" in the same group counts; everyone else's is ordinary chat.
import { jidNormalizedUser } from "baileys";

import {
  checkReminderDraft,
  REMINDER_CONFIRM_MS,
  REMINDER_LATE_REPLY_MS,
  type HandledStatus,
  type Json,
  type ReminderDraft,
  type ReminderPermission,
} from "@soft-agent-support/shared";

import { confirmReminder, reminderSet, TEMPLATES } from "../assistant/templates.ts";
import type { AuditStore } from "../db/auditRepo.ts";
import type { AuthorizedUserStore } from "../db/authorizedUsersRepo.ts";
import type { ReminderRequestStore } from "../db/reminderRequestsRepo.ts";
import type { Logger } from "../logger.ts";
import { canCreateReminder } from "./permission.ts";

/** What to reply and record; the pipeline sends it. */
export type FlowReply = {
  text: string;
  status: HandledStatus;
  action: string;
  detail: Record<string, Json>;
  /** Called with the sent reply's WhatsApp ID (the confirmation message is remembered). */
  onSent?: (waMessageId: string) => Promise<void>;
};

export type ReminderFlow = {
  handleRequest(input: {
    groupId: string;
    permission: ReminderPermission;
    senderJid: string;
    senderPhoneE164: string | null;
    sourceWaMessageId: string;
    draft: ReminderDraft;
    timeZone: string;
  }): Promise<FlowReply>;
  /** A "yes" / "no" from someone; null when it isn't about their reminder (ordinary chat). */
  handleReplyWord(input: {
    groupId: string;
    senderJid: string;
    word: "yes" | "no";
    timeZone: string;
  }): Promise<FlowReply | null>;
  /** Marks overdue requests expired (scheduler tick); nothing is sent. */
  expireOverdue(): Promise<void>;
};

const DRAFT_REPLIES = {
  unclear_time: TEMPLATES.unclearTime,
  too_soon: TEMPLATES.tooSoon,
  too_far: TEMPLATES.tooFar,
  bad_text: TEMPLATES.badText,
} as const;

export function createReminderFlow(deps: {
  requests: ReminderRequestStore;
  authorizedUsers: AuthorizedUserStore;
  audit: AuditStore;
  logger: Logger;
  now?: () => number;
}): ReminderFlow {
  const now = deps.now ?? Date.now;
  const log = deps.logger.child({ module: "reminders" });

  return {
    async handleRequest(input): Promise<FlowReply> {
      const decision = canCreateReminder({
        permission: input.permission,
        groupId: input.groupId,
        senderPhone: input.senderPhoneE164,
        authorizedUsers:
          input.permission === "any_member" ? [] : await deps.authorizedUsers.listActive(),
      });
      if (decision !== "allowed") {
        return {
          text: decision === "no_phone" ? TEMPLATES.noPhone : TEMPLATES.notAuthorized,
          status: "refused",
          action: "refused_unauthorized",
          detail: { intent: "create_reminder", reason: decision },
        };
      }

      const check = checkReminderDraft(input.draft, input.timeZone, new Date(now()));
      if (!check.ok) {
        return {
          text: DRAFT_REPLIES[check.reason],
          status: "answered",
          action: "reminder_unclear",
          detail: { intent: "create_reminder", reason: check.reason },
        };
      }

      const requestId = await deps.requests.create({
        groupId: input.groupId,
        requesterJid: jidNormalizedUser(input.senderJid),
        requesterPhoneE164: input.senderPhoneE164,
        sourceWaMessageId: input.sourceWaMessageId,
        body: check.body,
        dueAt: check.dueAt,
        expiresAt: new Date(now() + REMINDER_CONFIRM_MS),
      });
      return {
        text: confirmReminder(check.body, check.dueAt, input.timeZone),
        status: "answered",
        action: "reminder_requested",
        detail: { intent: "create_reminder", requestId, dueAt: check.dueAt.toISOString() },
        onSent: (waMessageId) =>
          deps.requests.setConfirmationMessage(requestId, waMessageId).catch((error: unknown) => {
            log.error({ err: error, requestId }, "could not store the confirmation message id");
          }),
      };
    },

    async handleReplyWord(input): Promise<FlowReply | null> {
      const requesterJid = jidNormalizedUser(input.senderJid);
      const at = new Date(now());
      const request = await deps.requests.findAwaiting(input.groupId, requesterJid, at);

      if (!request) {
        const late = await deps.requests.expiredSince(
          input.groupId,
          requesterJid,
          new Date(at.getTime() - REMINDER_LATE_REPLY_MS),
          at,
        );
        return late
          ? {
              text: TEMPLATES.requestExpired,
              status: "answered",
              action: "reminder_late_reply",
              detail: { word: input.word },
            }
          : null;
      }

      if (input.word === "no") {
        await deps.requests.decline(request.id);
        return {
          text: TEMPLATES.reminderCancelled,
          status: "answered",
          action: "reminder_declined",
          detail: { requestId: request.id },
        };
      }

      const postId = await deps.requests.confirm(request.id, requesterJid);
      if (!postId) {
        // Expired or confirmed between the read and now: nothing was saved, so never say it was.
        return {
          text: TEMPLATES.requestExpired,
          status: "answered",
          action: "reminder_late_reply",
          detail: { requestId: request.id, word: "yes" },
        };
      }
      log.info({ requestId: request.id, postId }, "reminder confirmed");
      return {
        text: reminderSet(request.dueAt, input.timeZone),
        status: "answered",
        action: "reminder_confirmed",
        detail: { requestId: request.id, postId, dueAt: request.dueAt.toISOString() },
      };
    },

    async expireOverdue() {
      for (const request of await deps.requests.expireOverdue(new Date(now()))) {
        await deps.audit
          .record({
            action: "reminder_expired",
            actorType: "system",
            actorRef: "scheduler",
            groupId: request.groupId,
            detail: { requestId: request.id },
          })
          .catch((error: unknown) => log.error({ err: error }, "audit write failed"));
      }
    },
  };
}
