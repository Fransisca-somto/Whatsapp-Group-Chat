import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import type { SocketLike } from "../whatsapp/connection.ts";
import { createIngest } from "./ingest.ts";
import { memoryAudit, memoryGroups, memoryMessages } from "./testStores.ts";

const logger = pino({ level: "silent" });
const GROUP = "120363000000000001@g.us";

type Listener = (payload: unknown) => void;

function fakeSocket(groupsOnWhatsApp: Record<string, { subject: string }> = {}) {
  const listeners = new Map<string, Listener[]>();
  const sock = {
    ev: {
      on: (event: string, listener: Listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    user: { id: "2348000000000:4@s.whatsapp.net", lid: "11112222:4@lid" },
    groupMetadata: vi.fn((jid: string) =>
      Promise.resolve({ id: jid, subject: groupsOnWhatsApp[jid]?.subject ?? "Fetched name" }),
    ),
    groupFetchAllParticipating: vi.fn(() => Promise.resolve(groupsOnWhatsApp)),
    signalRepository: { lidMapping: { getPNForLID: vi.fn(() => Promise.resolve(null)) } },
  };
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  return { sock: sock as unknown as SocketLike, emit };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function setup(initial: Parameters<typeof memoryGroups>[0] = []) {
  const groups = memoryGroups(initial);
  const messages = memoryMessages();
  const onTagged = vi.fn();
  const ingest = createIngest({
    groups: groups.store,
    messages: messages.store,
    audit: memoryAudit().store,
    logger,
    onTagged,
  });
  return { ingest, groups, messages, onTagged };
}

describe("ingest wiring", () => {
  it("marks the group removed when the bot is removed (participant given as a LID object)", async () => {
    const t = setup([{ jid: GROUP, name: "Team", status: "active" }]);
    const { sock, emit } = fakeSocket();
    t.ingest.attach(sock);
    emit("group-participants.update", {
      id: GROUP,
      author: "99887766@lid",
      participants: [{ id: "11112222@lid", phoneNumber: "2348000000000@s.whatsapp.net" }],
      action: "remove",
    });
    await settle();
    expect(t.groups.rows[0]?.status).toBe("removed");
  });

  it("ignores membership changes that do not involve the bot", async () => {
    const t = setup([{ jid: GROUP, name: "Team", status: "active" }]);
    const { sock, emit } = fakeSocket();
    t.ingest.attach(sock);
    emit("group-participants.update", {
      id: GROUP,
      author: "x",
      participants: [{ id: "55443322@lid" }],
      action: "remove",
    });
    await settle();
    expect(t.groups.rows[0]?.status).toBe("active");
  });

  it("registers a group as pending when the bot is added", async () => {
    const t = setup();
    const { sock, emit } = fakeSocket({ [GROUP]: { subject: "Ops" } });
    t.ingest.attach(sock);
    emit("groups.upsert", [{ id: GROUP, subject: "Ops" }]);
    await settle();
    expect(t.groups.rows).toEqual([
      expect.objectContaining({ jid: GROUP, name: "Ops", status: "pending" }),
    ]);
  });

  it("applies renames from WhatsApp", async () => {
    const t = setup([{ jid: GROUP, name: "Old", status: "active" }]);
    const { sock, emit } = fakeSocket();
    t.ingest.attach(sock);
    emit("groups.update", [{ id: GROUP, subject: "New" }]);
    await settle();
    expect(t.groups.rows[0]?.name).toBe("New");
  });

  it("stores new messages but ignores history appends", async () => {
    const t = setup([{ jid: GROUP, name: "Team", status: "active" }]);
    const { sock, emit } = fakeSocket();
    t.ingest.attach(sock);
    const message = (id: string) => ({
      key: { remoteJid: GROUP, id, participant: "2348012345678@s.whatsapp.net" },
      message: { conversation: id },
      messageTimestamp: 1_760_800_000,
    });
    emit("messages.upsert", { type: "append", messages: [message("OLD")] });
    emit("messages.upsert", { type: "notify", messages: [message("NEW")] });
    await settle();
    expect(t.messages.rows.map((m) => m.waMessageId)).toEqual(["NEW"]);
  });

  it("syncs groups when the connection opens", async () => {
    const t = setup([{ jid: "999@g.us", name: "Gone", status: "active" }]);
    const { sock } = fakeSocket({ [GROUP]: { subject: "Team" } });
    await t.ingest.syncOnOpen(sock);
    expect(t.groups.rows.map((r) => [r.jid, r.status])).toEqual([
      ["999@g.us", "removed"],
      [GROUP, "pending"],
    ]);
  });
});
