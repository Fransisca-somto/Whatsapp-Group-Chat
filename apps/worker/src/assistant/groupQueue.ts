// Tagged messages are handled one at a time per group, groups in parallel (api-interfaces.md
// §8.2). Keeps replies in order and, from Phase 6, confirmation matching correct.
import type { Logger } from "../logger.ts";

export type GroupQueue = {
  run(groupId: string, task: () => Promise<void>): Promise<void>;
};

export function createGroupQueue(logger: Logger): GroupQueue {
  const tails = new Map<string, Promise<void>>();
  const log = logger.child({ module: "group-queue" });

  return {
    run(groupId, task) {
      const previous = tails.get(groupId) ?? Promise.resolve();
      const next = previous.then(task).catch((error: unknown) => {
        // The task handles its own errors; this only stops one failure blocking the group.
        log.error({ err: error, groupId }, "tagged message task failed");
      });
      tails.set(groupId, next);
      void next.then(() => {
        if (tails.get(groupId) === next) tails.delete(groupId);
      });
      return next;
    },
  };
}
