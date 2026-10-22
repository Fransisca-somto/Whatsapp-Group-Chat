import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { createGroupDirectory } from "./groupDirectory.ts";
import { planGroupSync, syncGroups } from "./groupSync.ts";
import { memoryAudit, memoryGroups } from "./testStores.ts";

const logger = pino({ level: "silent" });
const A = "111@g.us";
const B = "222@g.us";
const C = "333@g.us";

function setup(initial: Parameters<typeof memoryGroups>[0] = []) {
  const groups = memoryGroups(initial);
  const audit = memoryAudit();
  let clock = 0;
  const directory = createGroupDirectory({
    store: groups.store,
    audit: audit.store,
    logger,
    now: () => clock,
  });
  return { directory, groups, audit, advance: (ms: number) => (clock += ms) };
}

describe("group directory", () => {
  it("adds a new group as pending and audits it", async () => {
    const t = setup();
    const group = await t.directory.present(A, "Sales team");
    expect(group).toMatchObject({ jid: A, name: "Sales team", status: "pending" });
    expect(t.audit.entries.map((e) => e.action)).toEqual(["group_detected"]);
  });

  it("renames a known group", async () => {
    const t = setup([{ jid: A, name: "Old", status: "active" }]);
    await t.directory.present(A, "New");
    expect(t.groups.rows[0]).toMatchObject({ name: "New", status: "active" });
    expect(t.audit.entries[0]).toMatchObject({
      action: "group_renamed",
      detail: { previousName: "Old" },
    });
  });

  it("sends a re-added group back to pending, but leaves archived groups archived", async () => {
    const t = setup([
      { jid: A, name: "Removed", status: "removed" },
      { jid: B, name: "Archived", status: "archived" },
    ]);
    await t.directory.present(A, "Removed");
    await t.directory.present(B, "Archived");
    expect(t.groups.rows.map((r) => r.status)).toEqual(["pending", "archived"]);
    expect(t.audit.entries.map((e) => e.action)).toEqual(["group_readded"]);
  });

  it("marks live groups removed when the bot leaves, and ignores the rest", async () => {
    const t = setup([
      { jid: A, name: "Active", status: "active" },
      { jid: B, name: "Archived", status: "archived" },
    ]);
    await t.directory.gone(A, "bot removed");
    await t.directory.gone(B, "bot removed");
    await t.directory.gone(C, "bot removed"); // unknown group: nothing to do
    expect(t.groups.rows.map((r) => r.status)).toEqual(["removed", "archived"]);
    expect(t.audit.entries).toHaveLength(1);
    expect(t.audit.entries[0]).toMatchObject({
      action: "group_removed",
      detail: { previousStatus: "active" },
    });
  });

  it("caches lookups for 30 s and refreshes after", async () => {
    const t = setup([{ jid: A, name: "Team", status: "pending" }]);
    await t.directory.get(A);
    await t.directory.get(A);
    expect(t.groups.findByJid).toHaveBeenCalledTimes(1);

    const row = t.groups.rows[0];
    if (row) row.status = "active"; // approved from the dashboard
    expect((await t.directory.get(A))?.status).toBe("pending"); // still cached
    t.advance(30_001);
    expect((await t.directory.get(A))?.status).toBe("active");
  });
});

describe("group sync", () => {
  it("plans present and left groups", () => {
    const plan = planGroupSync(
      [
        { id: "1", jid: A, name: "A", status: "active" },
        { id: "2", jid: B, name: "B", status: "paused" },
        { id: "3", jid: C, name: "C", status: "archived" },
      ],
      { [A]: { subject: "A" }, "444@g.us": { subject: "  " } },
    );
    expect(plan.present).toEqual([
      { jid: A, name: "A" },
      { jid: "444@g.us", name: "Unnamed group" },
    ]);
    expect(plan.gone).toEqual([B]); // archived C is left alone
  });

  it("applies the plan through the directory", async () => {
    const t = setup([
      { jid: A, name: "A", status: "active" },
      { jid: B, name: "B", status: "pending" },
    ]);
    await syncGroups({
      directory: t.directory,
      listKnown: () => t.groups.store.listAll(),
      fetchParticipating: () =>
        Promise.resolve({ [A]: { subject: "A renamed" }, [C]: { subject: "C" } }),
      logger,
    });
    expect(t.groups.rows.map((r) => [r.jid, r.name, r.status])).toEqual([
      [A, "A renamed", "active"],
      [B, "B", "removed"],
      [C, "C", "pending"],
    ]);
  });
});
