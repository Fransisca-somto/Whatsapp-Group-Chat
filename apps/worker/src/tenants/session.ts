// One tenant's WhatsApp session (ADR-039): everything that used to run once per worker now runs
// once per tenant, with every repository limited to that tenant. Moved out of index.ts unchanged
// apart from that: session state, the connection, pairing, the heartbeat, owner alerts, group and
// message ingestion, the assistant, reminders, background search indexing and the scheduler.
import type { EmbeddingsClient } from "../ai/embeddings.ts";
import type { OpenRouterClient } from "../ai/openrouter.ts";
import { createAssistant } from "../assistant/pipeline.ts";
import { cachedAiSettings, createAiSettingsRepo } from "../db/aiSettingsRepo.ts";
import { createAlertsRepo } from "../db/alertsRepo.ts";
import type { AttachmentsStore } from "../db/attachmentsStore.ts";
import { createAuditRepo } from "../db/auditRepo.ts";
import { createAuthorizedUsersRepo } from "../db/authorizedUsersRepo.ts";
import { createAuthStateRepo } from "../db/authStateRepo.ts";
import { createConnectionRepo } from "../db/connectionRepo.ts";
import { createEmbeddingsRepo } from "../db/embeddingsRepo.ts";
import { createGroupsRepo } from "../db/groupsRepo.ts";
import { createKnowledgeRepo } from "../db/knowledgeRepo.ts";
import { createMessagesRepo } from "../db/messagesRepo.ts";
import { createPairingRepo } from "../db/pairingRepo.ts";
import { createReminderRequestsRepo } from "../db/reminderRequestsRepo.ts";
import { createScheduledPostsRepo } from "../db/scheduledPostsRepo.ts";
import { createSearchRepo } from "../db/searchRepo.ts";
import type { ServiceClient } from "../db/supabase.ts";
import { createUsageRepo } from "../db/usageRepo.ts";
import { createEmbeddingJob, type EmbeddingJob } from "../embeddings/embeddingJob.ts";
import { createAlerter } from "../health/alerts.ts";
import type { EmailSender } from "../health/email.ts";
import { createHeartbeat, type Heartbeat } from "../health/heartbeat.ts";
import { botIdentity, createIngest } from "../ingest/ingest.ts";
import type { Logger } from "../logger.ts";
import type { VoiceConverter } from "../media/convertVoice.ts";
import { createPairingWatcher, type PairingWatcher } from "../pairing/pairingWatcher.ts";
import { createReminderFlow } from "../reminders/reminderFlow.ts";
import { createScheduler, type Scheduler } from "../scheduler/scheduler.ts";
import { createSupabaseAuthState } from "../whatsapp/authState.ts";
import {
  createConnectionManager,
  type ConnectionManager,
  type SocketFactory,
  type SocketLike,
} from "../whatsapp/connection.ts";
import { phoneFromJid } from "../whatsapp/jids.ts";
import { createSendQueue, type SendQueue } from "../whatsapp/sendQueue.ts";

/** Shared by every tenant session: clients and settings that hold no tenant data. */
export type SessionShared = {
  db: ServiceClient;
  instanceId: string;
  logger: Logger;
  /** The worker holds the leader lock (one lock for every tenant, architecture.md §5). */
  lockHeld: () => boolean;
  encryptionKey: Buffer;
  createSocket: SocketFactory;
  embeddings: EmbeddingsClient;
  ai: OpenRouterClient;
  attachments: AttachmentsStore;
  convertVoice: VoiceConverter;
  email: EmailSender;
  /** Resend settings and the platform alert list (used when an owner email is unknown). */
  alert: { apiKey: string; from: string; platformRecipients: string[]; dashboardUrl?: string };
  ownerEmail: (tenantId: string) => Promise<string | null>;
};

export async function startTenantSession(
  shared: SessionShared,
  tenantId: string,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  const { db, instanceId, lockHeld } = shared;
  const logger = shared.logger.child({ tenantId });

  const auth = createSupabaseAuthState({
    store: createAuthStateRepo(db, tenantId),
    encryptionKey: shared.encryptionKey,
    logger,
    canWrite: () => lockHeld(),
  });
  const connectionRepo = createConnectionRepo(db, tenantId);
  const groupsRepo = createGroupsRepo(db, tenantId);
  const messagesRepo = createMessagesRepo(db, tenantId);
  const auditRepo = createAuditRepo(db, tenantId);
  const usageRepo = createUsageRepo(db, tenantId);
  // Settings page changes apply within 60 s (api-interfaces.md §2.3).
  const aiSettings = cachedAiSettings(createAiSettingsRepo(db, tenantId));
  const reminders = createReminderFlow({
    requests: createReminderRequestsRepo(db, tenantId),
    authorizedUsers: createAuthorizedUsersRepo(db, tenantId),
    audit: auditRepo,
    logger,
  });

  // This tenant's socket; null whenever the session holds none.
  let currentSocket: SocketLike | null = null;
  let sendQueue: SendQueue | null = null;
  const assistant = createAssistant({
    groups: groupsRepo,
    messages: messagesRepo,
    knowledge: createKnowledgeRepo(db, tenantId),
    search: createSearchRepo(db),
    embeddings: shared.embeddings,
    reminders,
    usage: usageRepo,
    settings: aiSettings,
    audit: auditRepo,
    ai: shared.ai,
    send: {
      enqueue: (message) =>
        sendQueue
          ? sendQueue.enqueue(message)
          : Promise.reject(new Error("no session: cannot send")),
      stop: () => sendQueue?.stop(),
    },
    getBot: () => (currentSocket ? botIdentity(currentSocket) : { jid: null, lid: null }),
    logger,
  });
  const ingest = createIngest({
    groups: groupsRepo,
    messages: messagesRepo,
    audit: auditRepo,
    logger,
    onTagged: (message, group, raw) => assistant.handle(message, group, raw),
    onReplyWord: (message, group, raw) => assistant.handleReplyWord(message, group, raw),
  });

  const ownerEmail = await shared.ownerEmail(tenantId).catch((error: unknown) => {
    logger.error(
      { err: error },
      "could not read the owner's email; alerts go to the platform list",
    );
    return null;
  });
  const alerter = createAlerter({
    store: createAlertsRepo(db, tenantId),
    email: shared.email,
    recipients: ownerEmail ? [ownerEmail] : shared.alert.platformRecipients,
    apiKey: shared.alert.apiKey,
    from: shared.alert.from,
    logger,
    ...(shared.alert.dashboardUrl ? { dashboardUrl: shared.alert.dashboardUrl } : {}),
  });

  let connection: ConnectionManager | undefined;
  let pairing: PairingWatcher | undefined;
  let heartbeat: Heartbeat | undefined;
  let indexing: EmbeddingJob | undefined;
  let scheduler: Scheduler | undefined;

  const stopAll = async () => {
    // Lock lost: never write session state again from this instance.
    if (!lockHeld()) auth.discardPending();
    // Before the send queue stops, so a post in flight is finished or put back, never lost.
    await scheduler?.stop();
    sendQueue?.stop();
    sendQueue = null;
    currentSocket = null;
    heartbeat?.stop();
    await connection?.stop(); // closes the socket first
    await indexing?.stop();
    await pairing?.stop();
  };
  const live = () => lockHeld() && !signal.aborted;
  const checkpoint = () => {
    if (signal.aborted) throw new Error("tenant session stopped during startup");
  };

  try {
    await auth.load();
    checkpoint();
    // A running session means this tenant's bot is no longer offline.
    await alerter.resolve(["offline"]).catch((error: unknown) => {
      logger.error({ err: error }, "could not resolve offline alerts");
    });
    checkpoint();

    connection = createConnectionManager({
      auth,
      store: connectionRepo,
      logger,
      instanceId,
      createSocket: shared.createSocket,
      canConnect: live,
      onSocket: (sock) => {
        currentSocket = sock;
        ingest.attach(sock);
      },
      onAlert: (kind, detail) => {
        if (kind !== "offline") alerter.notify(kind, detail);
      },
    });
    connection.onOpen((sock) => {
      void ingest.syncOnOpen(sock).catch((error: unknown) => {
        logger.error({ err: error }, "group sync failed");
      });
      void alerter
        .resolve(["logged_out", "conflict", "reconnect_failures"])
        .catch((error: unknown) => {
          logger.error({ err: error }, "could not resolve alerts");
        });
    });
    // Only the lock holder sends; a fenced or stopped session never reaches WhatsApp.
    sendQueue = createSendQueue({
      getSocket: () => (live() ? currentSocket : null),
      logger,
    });
    pairing = createPairingWatcher({
      store: createPairingRepo(db, tenantId),
      connection,
      logger,
      onRelink: async () => {
        const marked = await groupsRepo.markForRelink(new Date());
        logger.info({ groups: marked }, "group statuses recorded before the number change");
        await auditRepo
          .record({ action: "relink_started", actorType: "system", detail: { groups: marked } })
          .catch((error: unknown) => logger.error({ err: error }, "audit write failed"));
      },
    });
    heartbeat = createHeartbeat({ store: connectionRepo, instanceId, logger });
    scheduler = createScheduler({
      store: createScheduledPostsRepo(db, tenantId),
      send: sendQueue,
      isConnected: () => live() && connection!.isOpen(),
      settings: aiSettings,
      audit: auditRepo,
      expireReminderRequests: () => reminders.expireOverdue(),
      attachments: shared.attachments,
      convertVoice: shared.convertVoice,
      recordBotMessage: async (groupId, waMessageId, text, type) => {
        const bot = currentSocket ? botIdentity(currentSocket) : { jid: null, lid: null };
        await messagesRepo.insertIfNew({
          groupId,
          waMessageId,
          senderJid: bot.jid ?? bot.lid ?? "bot",
          senderPhoneE164: phoneFromJid(bot.jid),
          senderName: null,
          isFromBot: true,
          type,
          body: text,
          quotedWaMessageId: null,
          mentionsBot: false,
          sentAt: new Date(),
          handledStatus: null,
        });
      },
      logger,
    });
    indexing = createEmbeddingJob({
      store: createEmbeddingsRepo(db, tenantId),
      settings: aiSettings,
      embeddings: shared.embeddings,
      usage: usageRepo,
      logger,
    });

    await connection.start();
    checkpoint();
    await pairing.start();
    checkpoint();
    await heartbeat.start();
    checkpoint();
    indexing.start();
    await scheduler.start();
    checkpoint();
    return stopAll;
  } catch (error) {
    // Never leave a half-started session (above all, an open socket) behind.
    await stopAll().catch((stopError: unknown) => {
      logger.error({ err: stopError }, "cleanup after failed startup errored");
    });
    throw error;
  }
}
