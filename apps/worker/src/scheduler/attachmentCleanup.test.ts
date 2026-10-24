import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import type { AuditEntry } from "../db/auditRepo.ts";
import { createAttachmentCleanup } from "./attachmentCleanup.ts";

const logger = pino({ level: "silent" });

function setup(due: string[][]) {
  const audits: AuditEntry[] = [];
  const removed: string[][] = [];
  let call = 0;
  const cleanup = createAttachmentCleanup({
    store: {
      dueForCleanup: vi.fn(() => Promise.resolve(due[call++] ?? [])),
      remove: (paths) => {
        removed.push(paths);
        return Promise.resolve(
          paths.map((path, i) => ({ id: `p-${path}-${i}`, groupId: "g1", kind: "image" })),
        );
      },
    },
    audit: {
      record: (entry) => {
        audits.push(entry);
        return Promise.resolve();
      },
    },
    logger,
  });
  return { cleanup, audits, removed };
}

describe("attachment cleanup (P30)", () => {
  it("deletes the files the database says nobody needs, and audits each post", async () => {
    const t = setup([["a1/poster.png", "a2/report.pdf"]]);
    expect(await t.cleanup.runOnce()).toBe(2);
    expect(t.removed).toEqual([["a1/poster.png", "a2/report.pdf"]]);
    expect(t.audits).toHaveLength(2);
    expect(t.audits[0]).toMatchObject({
      action: "attachment_deleted",
      actorType: "system",
      groupId: "g1",
      detail: { kind: "image" },
    });
  });

  it("does nothing when no file is due", async () => {
    const t = setup([]);
    expect(await t.cleanup.runOnce()).toBe(0);
    expect(t.removed).toEqual([]);
  });

  it("works through more than one batch", async () => {
    const full = Array.from({ length: 100 }, (_, i) => `f${i}/x.png`);
    const t = setup([full, ["last/x.png"]]);
    expect(await t.cleanup.runOnce()).toBe(101);
    expect(t.removed).toHaveLength(2);
  });
});
