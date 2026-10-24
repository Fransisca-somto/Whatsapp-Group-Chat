// What the worker knows about groups: a 30 s cache of each group's status (api-interfaces.md
// §2.3) plus the rules for "the bot is in this group" and "the bot left this group".
// Used by the sync on connect (groupSync.ts) and by live Baileys events (ingest.ts).
import type { AuditStore } from "../db/auditRepo.ts";
import type { GroupRecord, GroupStore } from "../db/groupsRepo.ts";
import type { Logger } from "../logger.ts";

export type GroupDirectory = {
  /** Cached lookup; null if the group is not in the database. */
  get(jid: string): Promise<GroupRecord | null>;
  /** The bot is in this group: add it as pending, re-add a removed one, or update its name. */
  present(jid: string, name: string): Promise<GroupRecord>;
  /** The bot is no longer in this group: mark it removed (archived groups stay archived). */
  gone(jid: string, reason: string): Promise<void>;
  /** The group's name changed on WhatsApp. */
  renamed(jid: string, name: string): Promise<void>;
};

/** A group in one of these statuses becomes `removed` when the bot leaves it. */
const LIVE_STATUSES = new Set(["pending", "active", "paused"]);
/** 7.1 / P38: how long after a number change a re-added group returns without re-approval. */
export const READMIT_WITHIN_MS = 30 * 24 * 60 * 60_000;

export function createGroupDirectory(options: {
  store: GroupStore;
  audit: AuditStore;
  logger: Logger;
  ttlMs?: number;
  now?: () => number;
}): GroupDirectory {
  const { store, audit, ttlMs = 30_000, now = Date.now } = options;
  const log = options.logger.child({ module: "groups" });
  const cache = new Map<string, { group: GroupRecord; expires: number }>();

  const remember = (group: GroupRecord) => {
    cache.set(group.jid, { group, expires: now() + ttlMs });
    return group;
  };

  const record = (action: string, group: GroupRecord, detail: Record<string, string> = {}) =>
    audit
      .record({
        action,
        actorType: "system",
        groupId: group.id,
        detail: { name: group.name, ...detail },
      })
      .catch((error: unknown) => log.error({ err: error, action }, "audit write failed"));

  async function fresh(jid: string) {
    cache.delete(jid);
    const group = await store.findByJid(jid);
    return group ? remember(group) : null;
  }

  return {
    async get(jid) {
      const hit = cache.get(jid);
      if (hit && hit.expires > now()) return hit.group;
      return fresh(jid);
    },

    async present(jid, name) {
      const existing = await fresh(jid);
      if (!existing) {
        const created = remember(await store.insertPending(jid, name));
        log.info({ jid, name }, "new group detected; waiting for approval");
        await record("group_detected", created);
        return created;
      }
      let group = existing;
      if (name && name !== group.name) {
        await store.rename(group.id, name);
        await record("group_renamed", { ...group, name }, { previousName: group.name });
        group = { ...group, name };
      }
      if (group.status === "removed") {
        // After a number change (7.1): back to the status it had, without re-approval.
        const relink = await store.relinkStatus(group.id);
        if (relink && now() - relink.at.getTime() <= READMIT_WITHIN_MS) {
          await store.readmit(group.id, relink.status);
          group = { ...group, status: relink.status };
          log.info({ jid, status: relink.status }, "new number added to the group; readmitted");
          await record("group_readmitted", group, { status: relink.status });
        } else {
          // Re-added after being removed for any other reason: needs approval again.
          await store.setStatus(group.id, "pending");
          group = { ...group, status: "pending" };
          log.info({ jid }, "bot re-added to a removed group; back to pending");
          await record("group_readded", group);
        }
      }
      return remember(group);
    },

    async gone(jid, reason) {
      const group = await fresh(jid);
      if (!group || !LIVE_STATUSES.has(group.status)) return;
      await store.setStatus(group.id, "removed");
      remember({ ...group, status: "removed" });
      log.warn({ jid, reason, previousStatus: group.status }, "bot no longer in group");
      await record("group_removed", group, { reason, previousStatus: group.status });
    },

    async renamed(jid, name) {
      const group = await fresh(jid);
      if (!group || !name || name === group.name) return;
      await store.rename(group.id, name);
      remember({ ...group, name });
      await record("group_renamed", { ...group, name }, { previousName: group.name });
    },
  };
}
