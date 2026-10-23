// Worker boot (architecture.md §2): validate env, start logging, take the leader lock, then
// start leader-only modules: session state, the WhatsApp connection, the pairing watcher, the
// heartbeat, owner alerts, group/message ingestion, the assistant that answers tags and the
// background search indexing.
import { randomUUID } from "node:crypto";

import { createEmbeddingsClient } from "./ai/embeddings.ts";
import { createOpenRouterClient } from "./ai/openrouter.ts";
import { createAssistant } from "./assistant/pipeline.ts";
import { cachedAiSettings, createAiSettingsRepo } from "./db/aiSettingsRepo.ts";

import { createAlertsRepo } from "./db/alertsRepo.ts";
import { createAuditRepo } from "./db/auditRepo.ts";
import { createAuthStateRepo } from "./db/authStateRepo.ts";
import { createConnectionRepo } from "./db/connectionRepo.ts";
import { createEmbeddingsRepo } from "./db/embeddingsRepo.ts";
import { createGroupsRepo } from "./db/groupsRepo.ts";
import { createKnowledgeRepo } from "./db/knowledgeRepo.ts";
import { createLockRepo } from "./db/lockRepo.ts";
import { createMessagesRepo } from "./db/messagesRepo.ts";
import { createPairingRepo } from "./db/pairingRepo.ts";
import { createSearchRepo } from "./db/searchRepo.ts";
import { createServiceClient } from "./db/supabase.ts";
import { createUsageRepo } from "./db/usageRepo.ts";
import { createEmbeddingJob, type EmbeddingJob } from "./embeddings/embeddingJob.ts";
import { EnvError, parseEnv } from "./env.ts";
import { createLeaderLock } from "./lock/leaderLock.ts";
import { runLeaderLoop, type StartLeaderSession } from "./lock/leaderLoop.ts";
import { createAlerter } from "./health/alerts.ts";
import { createResendSender } from "./health/email.ts";
import { createHeartbeat, type Heartbeat } from "./health/heartbeat.ts";
import { botIdentity, createIngest } from "./ingest/ingest.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createPairingWatcher, type PairingWatcher } from "./pairing/pairingWatcher.ts";
import { createSupabaseAuthState } from "./whatsapp/authState.ts";
import {
  createBaileysSocketFactory,
  createConnectionManager,
  type ConnectionManager,
  type SocketLike,
} from "./whatsapp/connection.ts";
import { createSendQueue, type SendQueue } from "./whatsapp/sendQueue.ts";

const SHUTDOWN_TIMEOUT_MS = 10_000;

function loadEnvOrExit() {
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvError) {
      // The logger is not configured yet; print the plain list and stop.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

function installProcessHandlers(logger: Logger, shutdown: (signal: string) => Promise<void>) {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled promise rejection");
    process.exit(1);
  });
}

function main() {
  const env = loadEnvOrExit();
  const instanceId = randomUUID();
  const logger = createLogger(env.LOG_LEVEL).child({ instanceId });
  const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const lock = createLeaderLock({ store: createLockRepo(db), instanceId, logger });
  const stopping = new AbortController();

  const auth = createSupabaseAuthState({
    store: createAuthStateRepo(db),
    encryptionKey: Buffer.from(env.SESSION_ENCRYPTION_KEY, "base64"),
    logger,
    canWrite: () => lock.isHeld(),
  });
  const connectionRepo = createConnectionRepo(db);
  const pairingRepo = createPairingRepo(db);
  const createSocket = createBaileysSocketFactory(logger);
  const groupsRepo = createGroupsRepo(db);
  const messagesRepo = createMessagesRepo(db);
  const auditRepo = createAuditRepo(db);
  const usageRepo = createUsageRepo(db);
  // Settings page changes apply within 60 s (api-interfaces.md §2.3).
  const aiSettings = cachedAiSettings(createAiSettingsRepo(db));
  const embeddings = createEmbeddingsClient();

  // The socket of the current leader session; null whenever this instance holds none.
  let currentSocket: SocketLike | null = null;
  let sendQueue: SendQueue | null = null;
  const assistant = createAssistant({
    groups: groupsRepo,
    messages: messagesRepo,
    knowledge: createKnowledgeRepo(db),
    search: createSearchRepo(db),
    embeddings,
    usage: usageRepo,
    settings: aiSettings,
    audit: auditRepo,
    ai: createOpenRouterClient({ logger }),
    send: {
      enqueue: (message) =>
        sendQueue
          ? sendQueue.enqueue(message)
          : Promise.reject(new Error("no leader session: cannot send")),
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
  });
  const alerter = createAlerter({
    store: createAlertsRepo(db),
    email: createResendSender({ apiKey: env.RESEND_API_KEY, from: env.ALERT_FROM_EMAIL, logger }),
    recipients: env.OWNER_ALERT_EMAILS,
    apiKey: env.RESEND_API_KEY,
    from: env.ALERT_FROM_EMAIL,
    logger,
    ...(env.DASHBOARD_URL ? { dashboardUrl: env.DASHBOARD_URL } : {}),
  });

  const startLeaderSession: StartLeaderSession = async (signal) => {
    let connection: ConnectionManager | undefined;
    let pairing: PairingWatcher | undefined;
    let heartbeat: Heartbeat | undefined;
    let indexing: EmbeddingJob | undefined;

    const stopAll = async () => {
      // Lock lost: never write session state again from this instance.
      if (!lock.isHeld()) auth.discardPending();
      sendQueue?.stop();
      sendQueue = null;
      currentSocket = null;
      heartbeat?.stop();
      await connection?.stop(); // closes the socket first
      await indexing?.stop();
      await pairing?.stop();
    };
    const checkpoint = () => {
      if (signal.aborted) throw new Error("lock lost or shutdown during startup");
    };

    try {
      await auth.load();
      checkpoint();
      // Keep the database's offline check using the same email settings as this worker.
      await alerter.configureDatabase().catch((error: unknown) => {
        logger.error({ err: error }, "could not configure database alert email");
      });
      // A running leader means the worker is no longer offline.
      await alerter.resolve(["offline"]).catch((error: unknown) => {
        logger.error({ err: error }, "could not resolve offline alerts");
      });
      checkpoint();

      connection = createConnectionManager({
        auth,
        store: connectionRepo,
        logger,
        instanceId,
        createSocket,
        canConnect: () => lock.isHeld() && !signal.aborted,
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
      // Only the lock holder sends; a fenced session never reaches WhatsApp.
      sendQueue = createSendQueue({
        getSocket: () => (lock.isHeld() && !signal.aborted ? currentSocket : null),
        logger,
      });
      pairing = createPairingWatcher({ store: pairingRepo, connection, logger });
      heartbeat = createHeartbeat({ store: connectionRepo, instanceId, logger });
      indexing = createEmbeddingJob({
        store: createEmbeddingsRepo(db),
        settings: aiSettings,
        embeddings,
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
      return stopAll;
    } catch (error) {
      // Never leave a half-started session (above all, an open socket) behind.
      await stopAll().catch((stopError: unknown) => {
        logger.error({ err: stopError }, "cleanup after failed startup errored");
      });
      throw error;
    }
  };

  logger.info({ node: process.version, logLevel: env.LOG_LEVEL }, "worker: boot");
  const loop = runLeaderLoop(lock, startLeaderSession, stopping.signal, logger);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker: shutting down");
    const timer = setTimeout(() => {
      logger.error("worker: shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    stopping.abort();
    try {
      await loop; // stops the leader session (socket closes first)
      await lock.release(); // then the lease, per architecture.md §5
    } catch (error) {
      logger.error({ err: error }, "worker: error during shutdown");
    }
    logger.info("worker: stopped");
    process.exit(0);
  };

  installProcessHandlers(logger, shutdown);
}

main();
