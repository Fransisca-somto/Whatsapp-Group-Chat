// Tenant supervisor (ADR-039, architecture.md §5): while this worker holds the leader lock, it
// runs one WhatsApp session per active tenant. On start, every 30 s and whenever the tenants table
// changes, it starts sessions for new or reactivated tenants and stops those of suspended or
// removed ones. One tenant's failure never touches another: a session that fails to start is
// retried later with a growing delay.
import type { TenantStore } from "../db/tenantsRepo.ts";
import type { Logger } from "../logger.ts";

/** Starts one tenant's session; resolves to a function that stops it. Must honour `signal`. */
export type StartTenantSession = (
  tenantId: string,
  signal: AbortSignal,
) => Promise<() => Promise<void>>;

export type TenantSupervisor = {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** One pass (tests call this directly). */
  sync(): Promise<void>;
  running(): string[];
};

type Running = { abort: AbortController; stop: () => Promise<void> };
type Backoff = { until: number; delayMs: number };

export function createTenantSupervisor(options: {
  store: Pick<TenantStore, "listActive" | "onChange">;
  startSession: StartTenantSession;
  logger: Logger;
  intervalMs?: number;
  firstRetryMs?: number;
  maxRetryMs?: number;
  now?: () => number;
}): TenantSupervisor {
  const {
    store,
    startSession,
    intervalMs = 30_000,
    firstRetryMs = 60_000,
    maxRetryMs = 10 * 60_000,
  } = options;
  const now = options.now ?? Date.now;
  const log = options.logger.child({ module: "tenantSupervisor" });
  const sessions = new Map<string, Running>();
  const backoff = new Map<string, Backoff>();
  let timer: NodeJS.Timeout | undefined;
  let unsubscribe: (() => Promise<void>) | undefined;
  let stopped = false;
  /** The session being started right now, so stop() can abort it. */
  let starting: AbortController | null = null;
  // Passes run one at a time, so a tenant is never started twice.
  let queue: Promise<void> = Promise.resolve();

  async function stopSession(tenantId: string) {
    const session = sessions.get(tenantId);
    if (!session) return;
    sessions.delete(tenantId);
    session.abort.abort();
    try {
      await session.stop();
      log.info({ tenantId }, "tenant session stopped");
    } catch (error) {
      log.error({ err: error, tenantId }, "tenant session did not stop cleanly");
    }
  }

  async function startOne(tenantId: string) {
    const wait = backoff.get(tenantId);
    if (wait && now() < wait.until) return;
    const abort = new AbortController();
    starting = abort;
    try {
      const stop = await startSession(tenantId, abort.signal);
      if (stopped) {
        await stop();
        return;
      }
      sessions.set(tenantId, { abort, stop });
      backoff.delete(tenantId);
      log.info({ tenantId }, "tenant session started");
    } catch (error) {
      const delayMs = wait ? Math.min(wait.delayMs * 2, maxRetryMs) : firstRetryMs;
      backoff.set(tenantId, { until: now() + delayMs, delayMs });
      if (stopped) return; // aborted by stop(), not a real failure
      log.error({ err: error, tenantId, retryInMs: delayMs }, "tenant session failed to start");
    } finally {
      starting = null;
    }
  }

  async function pass() {
    if (stopped) return;
    let active: string[];
    try {
      active = await store.listActive();
    } catch (error) {
      log.error({ err: error }, "could not list tenants; keeping current sessions");
      return;
    }
    const wanted = new Set(active);
    for (const tenantId of [...sessions.keys()]) {
      if (!wanted.has(tenantId)) await stopSession(tenantId);
    }
    for (const tenantId of [...backoff.keys()]) {
      if (!wanted.has(tenantId)) backoff.delete(tenantId);
    }
    for (const tenantId of active) {
      if (stopped) return;
      if (!sessions.has(tenantId)) await startOne(tenantId);
    }
  }

  function sync(): Promise<void> {
    queue = queue.then(pass, pass);
    return queue;
  }

  return {
    async start() {
      stopped = false;
      unsubscribe = store.onChange(() => void sync());
      await sync();
      timer = setInterval(() => void sync(), intervalMs);
    },

    async stop() {
      stopped = true;
      starting?.abort();
      if (timer) clearInterval(timer);
      timer = undefined;
      await unsubscribe?.().catch((error: unknown) => {
        log.warn({ err: error }, "could not unsubscribe from tenant changes");
      });
      unsubscribe = undefined;
      await queue.catch(() => undefined);
      await Promise.all([...sessions.keys()].map((tenantId) => stopSession(tenantId)));
      backoff.clear();
    },

    sync,
    running: () => [...sessions.keys()],
  };
}
