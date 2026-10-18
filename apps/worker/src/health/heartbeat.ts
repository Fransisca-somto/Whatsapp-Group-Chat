// Worker heartbeat (api-interfaces.md §2.2): the lock holder stamps wa_connection every 15 s.
// The dashboard shows the worker as offline when the stamp is older than 60 s.
import type { ConnectionStore } from "../db/connectionRepo.ts";
import type { Logger } from "../logger.ts";

export type Heartbeat = { start(): Promise<void>; stop(): void };

export function createHeartbeat(options: {
  store: ConnectionStore;
  instanceId: string;
  logger: Logger;
  intervalMs?: number;
}): Heartbeat {
  const { store, instanceId, intervalMs = 15_000 } = options;
  const log = options.logger.child({ module: "heartbeat" });
  let timer: NodeJS.Timeout | undefined;

  async function beat() {
    try {
      await store.update({ last_heartbeat_at: new Date().toISOString(), instance_id: instanceId });
    } catch (error) {
      log.warn({ err: error }, "heartbeat failed");
    }
  }

  return {
    async start() {
      await beat();
      timer = setInterval(() => void beat(), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
