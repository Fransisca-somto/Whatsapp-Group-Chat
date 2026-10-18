// Worker boot (architecture.md §2): validate env, start logging, take the leader lock, then
// start leader-only modules: session state, the WhatsApp connection and the pairing watcher.
// The heartbeat (1.6) and owner alerts (1.7) plug into startLeaderSession too.
import { randomUUID } from "node:crypto";

import { createAuthStateRepo } from "./db/authStateRepo.ts";
import { createConnectionRepo } from "./db/connectionRepo.ts";
import { createLockRepo } from "./db/lockRepo.ts";
import { createPairingRepo } from "./db/pairingRepo.ts";
import { createServiceClient } from "./db/supabase.ts";
import { EnvError, parseEnv } from "./env.ts";
import { createLeaderLock } from "./lock/leaderLock.ts";
import { runLeaderLoop, type StartLeaderSession } from "./lock/leaderLoop.ts";
import { createHeartbeat } from "./health/heartbeat.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createPairingWatcher } from "./pairing/pairingWatcher.ts";
import { createSupabaseAuthState } from "./whatsapp/authState.ts";
import { createBaileysSocketFactory, createConnectionManager } from "./whatsapp/connection.ts";

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

  const startLeaderSession: StartLeaderSession = async () => {
    await auth.load();
    const connection = createConnectionManager({
      auth,
      store: connectionRepo,
      logger,
      instanceId,
      createSocket,
      // Sending through the Meta Cloud API arrives in task 1.7.
      onAlert: (kind, detail) => logger.warn({ kind, detail }, "owner alert"),
    });
    const pairing = createPairingWatcher({ store: pairingRepo, connection, logger });
    const heartbeat = createHeartbeat({ store: connectionRepo, instanceId, logger });
    await connection.start();
    await pairing.start();
    await heartbeat.start();

    return async () => {
      // Lock lost: never write session state again from this instance.
      if (!lock.isHeld()) auth.discardPending();
      heartbeat.stop();
      await connection.stop(); // closes the socket first
      await pairing.stop();
    };
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
