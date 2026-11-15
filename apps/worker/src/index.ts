// Worker boot (architecture.md §2): validate env, start logging, take the leader lock, then run
// the leader-only part. Since Phase 8 (ADR-039) that is one WhatsApp session per active tenant,
// managed by the tenant supervisor (tenants/session.ts holds the per-tenant modules), plus the
// daily attachment cleanup, which serves every tenant. One lock still covers every connection.
import { randomUUID } from "node:crypto";

import { createEmbeddingsClient } from "./ai/embeddings.ts";
import { createOpenRouterClient } from "./ai/openrouter.ts";
import { configureDatabaseAlertEmail } from "./db/alertsRepo.ts";
import { createAttachmentsStore } from "./db/attachmentsStore.ts";
import { createAuditRepo } from "./db/auditRepo.ts";
import { createLockRepo } from "./db/lockRepo.ts";
import { createServiceClient } from "./db/supabase.ts";
import { createTenantsRepo } from "./db/tenantsRepo.ts";
import { EnvError, parseEnv } from "./env.ts";
import { createResendSender } from "./health/email.ts";
import { createLeaderLock } from "./lock/leaderLock.ts";
import { runLeaderLoop, type StartLeaderSession } from "./lock/leaderLoop.ts";
import { createLogger, type Logger } from "./logger.ts";
import { bundledFfmpegPath, createVoiceConverter } from "./media/convertVoice.ts";
import { createAttachmentCleanup, type AttachmentCleanup } from "./scheduler/attachmentCleanup.ts";
import { startTenantSession, type SessionShared } from "./tenants/session.ts";
import { createTenantSupervisor, type TenantSupervisor } from "./tenants/supervisor.ts";
import { createBaileysSocketFactory } from "./whatsapp/connection.ts";

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
  const tenants = createTenantsRepo(db);

  const ffmpegPath = bundledFfmpegPath();
  if (!ffmpegPath) {
    logger.warn("ffmpeg-static is not installed: voice notes will wait until it is (pnpm install)");
  }
  const attachments = createAttachmentsStore(db);
  const shared: SessionShared = {
    db,
    instanceId,
    logger,
    lockHeld: () => lock.isHeld(),
    encryptionKey: Buffer.from(env.SESSION_ENCRYPTION_KEY, "base64"),
    createSocket: createBaileysSocketFactory(logger),
    embeddings: createEmbeddingsClient(),
    ai: createOpenRouterClient({ logger }),
    attachments,
    convertVoice: createVoiceConverter({ ffmpegPath }),
    email: createResendSender({ apiKey: env.RESEND_API_KEY, from: env.ALERT_FROM_EMAIL, logger }),
    alert: {
      apiKey: env.RESEND_API_KEY,
      from: env.ALERT_FROM_EMAIL,
      platformRecipients: env.OWNER_ALERT_EMAILS,
      ...(env.DASHBOARD_URL ? { dashboardUrl: env.DASHBOARD_URL } : {}),
    },
    ownerEmail: (tenantId) => tenants.ownerEmail(tenantId),
  };

  const startLeaderSession: StartLeaderSession = async (signal) => {
    let supervisor: TenantSupervisor | undefined;
    let cleanup: AttachmentCleanup | undefined;

    const stopAll = async () => {
      await supervisor?.stop(); // every tenant's socket closes here
      await cleanup?.stop();
    };

    try {
      // Keep the database's offline check using the same Resend settings as this worker.
      await configureDatabaseAlertEmail(
        db,
        env.RESEND_API_KEY,
        env.OWNER_ALERT_EMAILS,
        env.ALERT_FROM_EMAIL,
      ).catch((error: unknown) => {
        logger.error({ err: error }, "could not configure database alert email");
      });
      if (signal.aborted) throw new Error("lock lost or shutdown during startup");

      supervisor = createTenantSupervisor({
        store: tenants,
        // A tenant session stops when the supervisor says so or when the leader session ends.
        startSession: (tenantId, tenantSignal) =>
          startTenantSession(shared, tenantId, AbortSignal.any([signal, tenantSignal])),
        logger,
      });
      cleanup = createAttachmentCleanup({
        store: attachments,
        auditFor: (tenantId) => createAuditRepo(db, tenantId),
        logger,
      });

      await supervisor.start();
      if (signal.aborted) throw new Error("lock lost or shutdown during startup");
      cleanup.start();
      return stopAll;
    } catch (error) {
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
      await loop; // stops every tenant session (sockets close first)
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
