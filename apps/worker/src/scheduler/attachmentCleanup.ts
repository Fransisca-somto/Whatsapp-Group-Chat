// Deletes post attachments no post needs any more (Phase 6, 6.9, P30): every post using the file
// is cancelled, or finished (sent, failed, uncertain, skipped) more than 30 days ago, and none is
// waiting or sending. The database decides which files (attachments_due_for_cleanup); this job
// deletes them from storage and marks the posts. Leader-only, once a day.
import type { AttachmentsStore } from "../db/attachmentsStore.ts";
import type { AuditStore } from "../db/auditRepo.ts";
import type { Logger } from "../logger.ts";

const DAY_MS = 24 * 60 * 60_000;
/** The first run waits a little, so it never competes with startup. */
const FIRST_RUN_MS = 10 * 60_000;
const BATCH = 100;

export type AttachmentCleanup = {
  start(): void;
  stop(): Promise<void>;
  /** One run (tests call this directly). Returns how many files were deleted. */
  runOnce(): Promise<number>;
};

export function createAttachmentCleanup(options: {
  store: Pick<AttachmentsStore, "dueForCleanup" | "remove">;
  audit: AuditStore;
  logger: Logger;
  intervalMs?: number;
  firstRunMs?: number;
}): AttachmentCleanup {
  const { store, intervalMs = DAY_MS, firstRunMs = FIRST_RUN_MS } = options;
  const log = options.logger.child({ module: "attachmentCleanup" });
  let first: NodeJS.Timeout | undefined;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<number> | null = null;

  async function runOnce(): Promise<number> {
    let deleted = 0;
    for (;;) {
      const paths = await store.dueForCleanup(BATCH);
      if (paths.length === 0) break;
      const posts = await store.remove(paths);
      deleted += paths.length;
      for (const post of posts) {
        await options.audit
          .record({
            action: "attachment_deleted",
            actorType: "system",
            actorRef: "cleanup",
            groupId: post.groupId,
            detail: { postId: post.id, kind: post.kind },
          })
          .catch((error: unknown) => log.error({ err: error }, "audit write failed"));
      }
      if (paths.length < BATCH) break;
    }
    if (deleted > 0) log.info({ deleted }, "unused attachments deleted");
    return deleted;
  }

  const run = () => {
    if (current) return;
    current = runOnce()
      .catch((error: unknown) => {
        log.error({ err: error }, "attachment cleanup failed; it runs again tomorrow");
        return 0;
      })
      .finally(() => {
        current = null;
      });
  };

  return {
    start() {
      if (first || timer) return;
      first = setTimeout(() => {
        first = undefined;
        run();
        timer = setInterval(run, intervalMs);
      }, firstRunMs);
    },
    async stop() {
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
      first = undefined;
      timer = undefined;
      await current;
    },
    runOnce,
  };
}
