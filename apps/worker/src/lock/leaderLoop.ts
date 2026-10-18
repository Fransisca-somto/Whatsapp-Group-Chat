// Runs the leader-only part of the worker (WhatsApp socket, heartbeat, pairing) only while this
// instance holds the lock. When the lock is lost, the session is stopped at once and the loop
// goes back to waiting; when the shutdown signal fires, the session is stopped and the loop ends.
import type { LeaderLock } from "./leaderLock.ts";
import type { Logger } from "../logger.ts";

/** Starts leader-only modules; resolves to a function that stops them. */
export type StartLeaderSession = () => Promise<() => Promise<void>>;

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

    const lost = new Promise<"lost">((resolve) => lock.startRenewal(() => resolve("lost")));
    let stop: (() => Promise<void>) | undefined;
    try {
      stop = await startSession();
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
