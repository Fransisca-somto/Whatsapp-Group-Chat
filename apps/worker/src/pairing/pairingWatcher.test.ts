import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PairingRequest, PairingStore } from "../db/pairingRepo.ts";
import { AlreadyLinkedError, type ConnectionManager } from "../whatsapp/connection.ts";
import { createPairingWatcher } from "./pairingWatcher.ts";

const logger = pino({ level: "silent" });

function setup(requests: PairingRequest[]) {
  const queue = [...requests];
  const statuses = new Map<string, string>();
  const finish = vi.fn((id: string, status: string) => {
    statuses.set(id, status);
    return Promise.resolve();
  });
  const markCodeIssued = vi.fn((id: string) => {
    statuses.set(id, "code_issued");
    return Promise.resolve();
  });
  const expireStale = vi.fn(() => Promise.resolve(0));
  const store: PairingStore = {
    nextRequested: () => Promise.resolve(queue.shift() ?? null),
    getStatus: (id) => Promise.resolve((statuses.get(id) as never) ?? null),
    markCodeIssued,
    finish,
    expireStale,
    onInsert: () => () => Promise.resolve(),
  };

  const openListeners = new Set<() => void>();
  const closedListeners = new Set<(reason: string) => void>();
  const pair = vi.fn(() => Promise.resolve("ABCD1234"));
  const relink = vi.fn(() => Promise.resolve());
  const cancelPairing = vi.fn(() => Promise.resolve());
  const connection = {
    pair,
    relink,
    cancelPairing,
    onOpen: (l: () => void) => {
      openListeners.add(l);
      return () => openListeners.delete(l);
    },
    onPairingClosed: (l: (r: string) => void) => {
      closedListeners.add(l);
      return () => closedListeners.delete(l);
    },
  } as unknown as ConnectionManager;

  const onRelink = vi.fn(() => Promise.resolve());
  const watcher = createPairingWatcher({
    store,
    connection,
    logger,
    codeTtlMs: 120_000,
    onRelink,
  });
  return {
    watcher,
    expireStale,
    statuses,
    finish,
    markCodeIssued,
    pair,
    relink,
    onRelink,
    cancelPairing,
    open: () => openListeners.forEach((l) => l()),
    closePairing: () => closedListeners.forEach((l) => l("closed")),
  };
}

const request = (kind: "pair" | "relink" = "pair"): PairingRequest => ({
  id: "req-1",
  kind,
  phoneE164: "+2348012345678",
  status: "requested",
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pairing watcher", () => {
  it("issues a code and marks the request paired when the connection opens", async () => {
    const t = setup([request()]);
    await t.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.pair).toHaveBeenCalledWith("+2348012345678");
    expect(t.markCodeIssued).toHaveBeenCalledWith("req-1", "ABCD1234", expect.any(Date));

    t.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.statuses.get("req-1")).toBe("paired");
    await t.watcher.stop();
  });

  it("relinks before pairing for a relink request", async () => {
    const t = setup([request("relink")]);
    await t.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.relink).toHaveBeenCalledBefore(t.pair);
    // 7.1: group statuses are recorded before the old number is logged out.
    expect(t.onRelink).toHaveBeenCalledBefore(t.relink);
    await t.watcher.stop();
  });

  it("still relinks if recording group statuses fails", async () => {
    const t = setup([request("relink")]);
    t.onRelink.mockRejectedValueOnce(new Error("database down"));
    await t.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.relink).toHaveBeenCalled();
    expect(t.pair).toHaveBeenCalled();
    await t.watcher.stop();
  });

  it("records nothing for a first link", async () => {
    const t = setup([request("pair")]);
    await t.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.onRelink).not.toHaveBeenCalled();
    await t.watcher.stop();
  });

  it("expires the request and abandons pairing when the code times out", async () => {
    const t = setup([request()]);
    await t.watcher.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.cancelPairing).toHaveBeenCalledWith("code expired");
    expect(t.statuses.get("req-1")).toBe("expired");
    await t.watcher.stop();
  });

  it("abandons pairing when the dashboard cancels", async () => {
    const t = setup([request()]);
    await t.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    t.statuses.set("req-1", "cancelled");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(t.cancelPairing).toHaveBeenCalledWith("cancelled from dashboard");
    expect(t.finish).not.toHaveBeenCalled();
    await t.watcher.stop();
  });

  it("marks the request expired when WhatsApp closes the pairing connection", async () => {
    const t = setup([request()]);
    await t.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    t.closePairing();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.statuses.get("req-1")).toBe("expired");
    await t.watcher.stop();
  });

  it("fails a pair request when a number is already linked, without touching the session", async () => {
    const t = setup([request()]);
    t.pair.mockRejectedValueOnce(new AlreadyLinkedError());
    await t.watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.finish).toHaveBeenCalledWith("req-1", "failed", expect.stringMatching(/Relink/));
    expect(t.cancelPairing).not.toHaveBeenCalled();
    await t.watcher.stop();
  });

  it("expires requests left open by a previous run on start", async () => {
    const t = setup([]);
    await t.watcher.start();
    expect(t.expireStale).toHaveBeenCalledOnce();
    await t.watcher.stop();
  });

  it("still starts when tidying up old requests fails (network blip)", async () => {
    const t = setup([request()]);
    t.expireStale.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(t.watcher.start()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.pair).toHaveBeenCalled(); // requests are still processed
    await t.watcher.stop();
  });
});
