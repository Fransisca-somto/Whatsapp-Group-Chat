// In-memory stores shared by the ingest tests. Like the real database, reads return copies, so
// later writes never change an object the code under test already holds.
import { vi } from "vitest";

import type { GroupStatus } from "@soft-agent-support/shared";

import type { AuditEntry, AuditStore } from "../db/auditRepo.ts";
import type { GroupRecord, GroupStore } from "../db/groupsRepo.ts";
import type { MessageStore, NewGroupMessage } from "../db/messagesRepo.ts";

export function memoryGroups(initial: Omit<GroupRecord, "id">[] = []) {
  let next = 1;
  const rows = initial.map((g) => ({ ...g, id: `g${next++}` }));
  const touchActivity = vi.fn(() => Promise.resolve());
  const copy = (row: GroupRecord | undefined) => (row ? { ...row } : null);
  const findByJid = vi.fn((jid: string) => Promise.resolve(copy(rows.find((r) => r.jid === jid))));
  const store: GroupStore = {
    listAll: () => Promise.resolve(rows.map((r) => ({ ...r }))),
    findByJid,
    insertPending: (jid, name) => {
      const row = { id: `g${next++}`, jid, name, status: "pending" as GroupStatus };
      rows.push(row);
      return Promise.resolve({ ...row });
    },
    rename: (id, name) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.name = name;
      return Promise.resolve();
    },
    setStatus: (id, status) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.status = status;
      return Promise.resolve();
    },
    touchActivity,
    assistantSettings: () =>
      Promise.resolve({ aiEnabled: true, dailyReplyCap: 200, botInstructions: null }),
  };
  return { rows, store, touchActivity, findByJid };
}

export function memoryMessages() {
  const rows: NewGroupMessage[] = [];
  const store: MessageStore = {
    insertIfNew: (m) => {
      if (rows.some((r) => r.groupId === m.groupId && r.waMessageId === m.waMessageId)) {
        return Promise.resolve(false);
      }
      rows.push(m);
      return Promise.resolve(true);
    },
    recent: (groupId, before, limit) =>
      Promise.resolve(
        rows
          .filter((r) => r.groupId === groupId && r.sentAt < before)
          .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
          .slice(-limit)
          .map((r) => ({
            senderName: r.senderName,
            senderPhoneE164: r.senderPhoneE164,
            isFromBot: r.isFromBot,
            type: r.type,
            body: r.body,
            sentAt: r.sentAt.toISOString(),
          })),
      ),
    setHandledStatus: (groupId, waMessageId, status) => {
      const row = rows.find((r) => r.groupId === groupId && r.waMessageId === waMessageId);
      if (row) row.handledStatus = status;
      return Promise.resolve();
    },
  };
  return { rows, store };
}

export function memoryAudit() {
  const entries: AuditEntry[] = [];
  const store: AuditStore = {
    record: (entry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  };
  return { entries, store };
}
