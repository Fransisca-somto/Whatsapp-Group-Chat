// On every connection open: reconcile the groups table with the groups the bot is actually in,
// so groups joined, renamed or left while the worker was offline are picked up.
import type { GroupRecord } from "../db/groupsRepo.ts";
import type { Logger } from "../logger.ts";
import type { GroupDirectory } from "./groupDirectory.ts";

export type SyncPlan = {
  present: { jid: string; name: string }[];
  gone: string[];
};

/** Pure: which groups the bot is in, and which known live groups it has left. */
export function planGroupSync(
  known: GroupRecord[],
  onWhatsApp: Record<string, { subject?: string | null }>,
): SyncPlan {
  const present = Object.entries(onWhatsApp).map(([jid, meta]) => ({
    jid,
    name: meta.subject?.trim() || "Unnamed group",
  }));
  const current = new Set(Object.keys(onWhatsApp));
  const gone = known
    .filter((g) => !current.has(g.jid) && ["pending", "active", "paused"].includes(g.status))
    .map((g) => g.jid);
  return { present, gone };
}

export async function syncGroups(deps: {
  directory: GroupDirectory;
  listKnown: () => Promise<GroupRecord[]>;
  fetchParticipating: () => Promise<Record<string, { subject?: string | null }>>;
  logger: Logger;
}): Promise<void> {
  const log = deps.logger.child({ module: "groupSync" });
  const [known, onWhatsApp] = await Promise.all([deps.listKnown(), deps.fetchParticipating()]);
  const plan = planGroupSync(known, onWhatsApp);
  for (const { jid, name } of plan.present) {
    await deps.directory.present(jid, name);
  }
  for (const jid of plan.gone) {
    await deps.directory.gone(jid, "not in the group when the worker reconnected");
  }
  log.info({ groups: plan.present.length, left: plan.gone.length }, "groups synced");
}
