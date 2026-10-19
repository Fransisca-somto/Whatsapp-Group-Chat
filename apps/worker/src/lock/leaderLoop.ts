// Runs the leader-only part of the worker (WhatsApp socket, heartbeat, pairing) only while this
// instance holds the lock. When the lock is lost, the session is stopped at once and the loop
// goes back to waiting; when the shutdown signal fires, the session is stopped and the loop ends.
// Startup itself receives a signal that aborts the moment the lock is lost (or shutdown starts),
// so a slow startup never keeps going without the lock.
import type { LeaderLock } from "./leaderLock.ts";
import type { Logger } from "../logger.ts";

/**
 * Starts leader-only modules; resolves to a function that stops them. Must stop anything it
 * started before rejecting, and must stop starting things once `signal` aborts.
 */
export type StartLeaderSession = (signal: AbortSignal) => Promise<() => Promise<void>>;

export async function runLeaderLoop(
  lock: LeaderLock,
  startSession: StartLeaderSession,
  signal: AbortSignal,
  logger: Logger,
): Promise<void> {
  const log = logger.child({ module: "leaderLoop" });
  const aborted = new Promise<"shutdown">((resolve) => {
    if (signal.aborted) resolve("shutdown");
    signal.addEventListener("abort", () => resolve("shutdown"), { once: true });
  });

  while (!signal.aborted) {
    await lock.waitForLock(signal);
    if (signal.aborted) break;

    const session = new AbortController();
    const onShutdown = () => session.abort();
    signal.addEventListener("abort", onShutdown, { once: true });
    const lost = new Promise<"lost">((resolve) =>
      lock.startRenewal(() => {
        session.abort();
        resolve("lost");
      }),
    );
    let stop: (() => Promise<void>) | undefined;
    try {
      stop = await startSession(session.signal);
      log.info("leader session started");
    } catch (error) {
      log.error({ err: error }, "leader session failed to start");
    }

    const outcome = stop ? await Promise.race([lost, aborted]) : "failed";
    if (stop) {
      try {
        await stop();
      } catch (error) {
        log.error({ err: error }, "leader session failed to stop cleanly");
      }
    }
    signal.removeEventListener("abort", onShutdown);
    log.info({ outcome }, "leader session ended");

    if (outcome === "failed") {
      // Give up the lease so another instance (or a later retry here) can start cleanly.
      await lock.release().catch((error: unknown) => {
        log.error({ err: error }, "lock release after failed start errored");
      });
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}
