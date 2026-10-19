// Handles pair / relink requests from the dashboard (api-interfaces.md §2.1).
// New rows arrive by Realtime, with a 10 s poll as the fallback. Requests are processed one at
// a time; each ends as paired, expired, failed or (by the dashboard) cancelled.
import type { PairingRequest, PairingStore } from "../db/pairingRepo.ts";
import type { Logger } from "../logger.ts";
import { AlreadyLinkedError, type ConnectionManager } from "../whatsapp/connection.ts";

export type PairingWatcherOptions = {
  store: PairingStore;
  connection: ConnectionManager;
  logger: Logger;
  pollMs?: number;
  /** How long a code is shown before the attempt is abandoned. */
  codeTtlMs?: number;
  /** How often to check whether the dashboard cancelled an open request. */
  cancelCheckMs?: number;
};

export type PairingWatcher = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

type Outcome = "paired" | "expired" | "cancelled" | "closed" | "stopped";

export function createPairingWatcher(options: PairingWatcherOptions): PairingWatcher {
  const {
    store,
    connection,
    pollMs = 10_000,
    codeTtlMs = 120_000,
    cancelCheckMs = 3_000,
  } = options;
  const log = options.logger.child({ module: "pairing" });

  let pollTimer: NodeJS.Timeout | undefined;
  let unsubscribe: (() => Promise<void>) | undefined;
  let busy = false;
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  const stopListeners = new Set<() => void>();

  function check() {
    if (busy || stopped) return;
    busy = true;
    current = (async () => {
      try {
        let request = await store.nextRequested();
        while (request && !stopped) {
          await handle(request);
          request = stopped ? null : await store.nextRequested();
        }
      } catch (error) {
        log.error({ err: error }, "pairing check failed");
      } finally {
        busy = false;
      }
    })();
  }

  async function handle(request: PairingRequest) {
    const log2 = log.child({ requestId: request.id, kind: request.kind });
    log2.info("pairing request received");
    try {
      if (request.kind === "relink") await connection.relink();
      const code = await connection.pair(request.phoneE164);
      const expiresAt = new Date(Date.now() + codeTtlMs);
      await store.markCodeIssued(request.id, code, expiresAt);

      const outcome = await waitForOutcome(request.id);
      log2.info({ outcome }, "pairing request finished");
      switch (outcome) {
        case "paired":
          await store.finish(request.id, "paired");
          break;
        case "expired":
          await connection.cancelPairing("code expired");
          await store.finish(request.id, "expired");
          break;
        case "closed":
          await store.finish(request.id, "expired", "WhatsApp closed the pairing connection");
          break;
        case "cancelled":
          await connection.cancelPairing("cancelled from dashboard");
          break;
        case "stopped":
          break; // the next leader expires it on startup
      }
    } catch (error) {
      if (stopped) return; // shutting down or fenced; the next leader expires the request
      const message = error instanceof Error ? error.message : String(error);
      log2.warn({ err: error }, "pairing request failed");
      if (!(error instanceof AlreadyLinkedError)) {
        await connection.cancelPairing("pairing failed").catch(() => {});
      }
      await store.finish(request.id, "failed", message).catch((finishError: unknown) => {
        log2.error({ err: finishError }, "could not mark pairing request failed");
      });
    }
  }

  function waitForOutcome(requestId: string): Promise<Outcome> {
    return new Promise((resolve) => {
      const cleanups: (() => void)[] = [];
      const done = (outcome: Outcome) => {
        for (const cleanup of cleanups) cleanup();
        resolve(outcome);
      };
      cleanups.push(connection.onOpen(() => done("paired")));
      cleanups.push(connection.onPairingClosed(() => done("closed")));

      const expiry = setTimeout(() => done("expired"), codeTtlMs);
      cleanups.push(() => clearTimeout(expiry));

      const cancelCheck = setInterval(() => {
        void store.getStatus(requestId).then(
          (status) => {
            if (status === "cancelled") done("cancelled");
          },
          (error: unknown) => log.warn({ err: error }, "could not check pairing request status"),
        );
      }, cancelCheckMs);
      cleanups.push(() => clearInterval(cancelCheck));

      const onStop = () => done("stopped");
      stopListeners.add(onStop);
      cleanups.push(() => stopListeners.delete(onStop));
    });
  }

  return {
    async start() {
      stopped = false;
      // Tidy-up only: a network blip here must not abort the whole leader startup.
      try {
        const expired = await store.expireStale();
        if (expired) log.info({ expired }, "expired pairing requests left by a previous run");
      } catch (error) {
        log.warn({ err: error }, "could not expire stale pairing requests; will continue");
      }
      unsubscribe = store.onInsert(() => check());
      const poll = () => {
        check();
        pollTimer = setTimeout(poll, pollMs);
      };
      poll();
    },

    async stop() {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = undefined;
      for (const listener of [...stopListeners]) listener();
      await current;
      await unsubscribe?.().catch((error: unknown) => {
        log.warn({ err: error }, "could not unsubscribe from pairing requests");
      });
      unsubscribe = undefined;
    },
  };
}
