import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LockStore } from "../db/lockRepo.ts";
import { createLeaderLock } from "./leaderLock.ts";

const logger = pino({ level: "silent" });

/** In-memory lease that mirrors acquire_worker_lock using fake-timer time. */
function memoryStore() {
  const state = { holder: null as string | null, expiresAt: 0, failNext: 0 };
  const acquire = vi.fn((instanceId: string, leaseSeconds: number) => {
    if (state.failNext > 0) {
      state.failNext -= 1;
      return Promise.reject(new Error("network down"));
    }
    const now = Date.now();
    if (state.expiresAt < now || state.holder === instanceId) {
      state.holder = instanceId;
      state.expiresAt = now + leaseSeconds * 1000;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  });
  const store: LockStore = {
    acquire,
    release: vi.fn((instanceId: string) => {
      if (state.holder === instanceId) {
        state.holder = null;
        state.expiresAt = 0;
      }
      return Promise.resolve();
    }),
  };
  return { state, store, acquire };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("leader lock", () => {
  it("acquires a free lease", async () => {
    const { state, store } = memoryStore();
    const lock = createLeaderLock({ store, instanceId: "a", logger });
    await lock.waitForLock();
    expect(lock.isHeld()).toBe(true);
    expect(state.holder).toBe("a");
  });

  it("keeps a second instance on standby while the first renews", async () => {
    const { state, store } = memoryStore();
    const a = createLeaderLock({ store, instanceId: "a", logger });
    const b = createLeaderLock({ store, instanceId: "b", logger });
    await a.waitForLock();
    a.startRenewal(() => {});

    const controller = new AbortController();
    const waiting = b.waitForLock(controller.signal);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(b.isHeld()).toBe(false);
    expect(state.holder).toBe("a");

    controller.abort();
    await waiting;
  });

  it("lets the standby take over after the holder releases", async () => {
    const { state, store } = memoryStore();
    const a = createLeaderLock({ store, instanceId: "a", logger });
    const b = createLeaderLock({ store, instanceId: "b", logger });
    await a.waitForLock();
    const waiting = b.waitForLock();
    await a.release();
    await vi.advanceTimersByTimeAsync(5_000);
    await waiting;
    expect(state.holder).toBe("b");
    expect(a.isHeld()).toBe(false);
  });

  it("lets the standby take over after the holder dies and its lease expires", async () => {
    const { state, store } = memoryStore();
    const a = createLeaderLock({ store, instanceId: "a", logger });
    const b = createLeaderLock({ store, instanceId: "b", logger });
    await a.waitForLock(); // a never renews: simulates a crashed process
    const waiting = b.waitForLock();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(state.holder).toBe("a");
    await vi.advanceTimersByTimeAsync(6_000);
    await waiting;
    expect(state.holder).toBe("b");
  });

  it("fences after two consecutive renewal errors, before the lease expires", async () => {
    const { state, store } = memoryStore();
    const lock = createLeaderLock({ store, instanceId: "a", logger });
    await lock.waitForLock();
    const leaseEnd = state.expiresAt;
    const onLost = vi.fn();
    lock.startRenewal(onLost);

    state.failNext = 2;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).toHaveBeenCalledOnce();
    expect(lock.isHeld()).toBe(false);
    expect(Date.now()).toBeLessThan(leaseEnd);
  });

  it("recovers from a single renewal error", async () => {
    const { state, store } = memoryStore();
    const lock = createLeaderLock({ store, instanceId: "a", logger });
    await lock.waitForLock();
    const onLost = vi.fn();
    lock.startRenewal(onLost);

    state.failNext = 1;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onLost).not.toHaveBeenCalled();
    expect(lock.isHeld()).toBe(true);
  });

  it("fences immediately when another instance holds the lease", async () => {
    const { state, store } = memoryStore();
    const lock = createLeaderLock({ store, instanceId: "a", logger });
    await lock.waitForLock();
    const onLost = vi.fn();
    lock.startRenewal(onLost);

    state.holder = "intruder";
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).toHaveBeenCalledWith("lease taken by another instance");
  });

  it("stops renewing after release, even with a renewal in flight", async () => {
    const { store, acquire } = memoryStore();
    const lock = createLeaderLock({ store, instanceId: "a", logger });
    await lock.waitForLock();
    const onLost = vi.fn();
    lock.startRenewal(onLost);
    await lock.release();

    const calls = acquire.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(acquire.mock.calls.length).toBe(calls);
    expect(onLost).not.toHaveBeenCalled();
  });
});
