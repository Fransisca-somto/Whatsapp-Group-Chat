// Worker boot (architecture.md §2): validate env, start logging, then start modules.
// Later tasks add the leader lock (1.2), session (1.3), pairing (1.4) and heartbeat (1.6),
// each registering its own cleanup with the shutdown sequence below.
import { EnvError, parseEnv } from "./env.ts";
import { createLogger, type Logger } from "./logger.ts";

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
  const logger = createLogger(env.LOG_LEVEL);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker: shutting down");
    const timer = setTimeout(() => {
      logger.error("worker: shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    // Module cleanup (socket close, auth flush, lock release) is awaited here in later tasks.
    await Promise.resolve();
    logger.info("worker: stopped");
    process.exit(0);
  };

  installProcessHandlers(logger, shutdown);
  logger.info({ node: process.version, logLevel: env.LOG_LEVEL }, "worker: boot");
}

main();
