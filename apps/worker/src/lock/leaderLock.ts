// Leader lock (architecture.md §5): guarantees at most one worker holds the WhatsApp connection.
//
// - waitForLock() retries acquire until this instance holds the lease (or is aborted).
// - startRenewal() renews every 10 s. Two failed renewals in a row (errors) fence the worker:
//   onLost fires so the caller closes the socket at once. A renewal that returns false means
//   another instance already holds the lease, so it fences immediately.
// - With a 30 s lease and 10 s renewals, fencing happens ~10 s before the lease could expire.
import type { LockStore } from "../db/lockRepo.ts";
import type { Logger } from "../logger.ts";

export type LeaderLockOptions = {
  store: LockStore;
  instanceId: string;
  logger: Logger;
  leaseSeconds?: number;
  renewIntervalMs?: number;
  acquireRetryMs?: number;
  maxRenewFailures?: number;
};

export type LeaderLock = {
  readonly instanceId: string;
  isHeld(): boolean;
  acquire(): Promise<boolean>;
  waitForLock(signal?: AbortSignal): Promise<void>;
  startRenewal(onLost: (reason: string) => void): void;
  release(): Promise<void>;
};

export function createLeaderLock(options: LeaderLockOptions): LeaderLock {
  const {
    store,
    instanceId,
    logger,
    leaseSeconds = 30,
    renewIntervalMs = 10_000,
    acquireRetryMs = 5_000,
    maxRenewFailures = 2,
  } = options;
  const log = logger.child({ module: "lock", instanceId });

  let held = false;
  let renewTimer: NodeJS.Timeout | undefined;
  // Bumped on every stop/start so a renewal still in flight cannot act after release().
  let generation = 0;

  function stopRenewal() {
    generation += 1;
    if (renewTimer) clearTimeout(renewTimer);
    renewTimer = undefined;
  }

  async function acquire(): Promise<boolean> {
    held = await store.acquire(instanceId, leaseSeconds);
    return held;
  }

  async function waitForLock(signal?: AbortSignal): Promise<void> {
    let loggedStandby = false;
    while (!signal?.aborted) {
      try {
        if (await acquire()) {
          log.info("lock acquired");
          return;
        }
        if (!loggedStandby) {
          log.info("lock held by another instance; standing by");
          loggedStandby = true;
        }
      } catch (error) {
        log.warn({ err: error }, "lock acquire failed; retrying");
      }
      await sleep(acquireRetryMs, signal);
    }
  }

  function startRenewal(onLost: (reason: string) => void): void {
    stopRenewal();
    const gen = generation;
    let failures = 0;

    const fence = (reason: string) => {
      held = false;
      stopRenewal();
      log.error({ reason }, "lock lost; fencing");
      onLost(reason);
    };

    const tick = async () => {
      try {
        const ok = await store.acquire(instanceId, leaseSeconds);
        if (gen !== generation) return;
        if (!ok) {
          fence("lease taken by another instance");
          return;
        }
        failures = 0;
      } catch (error) {
        if (gen !== generation) return;
        failures += 1;
        log.warn({ err: error, failures }, "lock renewal failed");
        if (failures >= maxRenewFailures) {
          fence(`${failures} consecutive renewal failures`);
          return;
        }
      }
      schedule();
    };

    const schedule = () => {
      renewTimer = setTimeout(() => void tick(), renewIntervalMs);
    };
    schedule();
  }

  async function release(): Promise<void> {
    stopRenewal();
    if (!held) return;
    held = false;
    await store.release(instanceId);
    log.info("lock released");
  }

  return { instanceId, isHeld: () => held, acquire, waitForLock, startRenewal, release };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
