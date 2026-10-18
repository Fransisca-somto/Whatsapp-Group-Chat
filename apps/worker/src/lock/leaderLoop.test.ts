import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import type { LeaderLock } from "./leaderLock.ts";
import { runLeaderLoop } from "./leaderLoop.ts";

const logger = pino({ level: "silent" });

function fakeLock() {
  let onLost: ((reason: string) => void) | undefined;
  const waitForLock = vi.fn(() => Promise.resolve());
  const lock: LeaderLock = {
    instanceId: "a",
    isHeld: () => true,
    acquire: () => Promise.resolve(true),
    waitForLock,
    startRenewal: (cb) => {
      onLost = cb;
    },
    release: vi.fn(() => Promise.resolve()),
  };
  return { lock, waitForLock, loseLock: () => onLost?.("test") };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("runLeaderLoop", () => {
  it("starts the session once the lock is held and stops it on shutdown", async () => {
    const { lock } = fakeLock();
    const stop = vi.fn(() => Promise.resolve());
    const start = vi.fn(() => Promise.resolve(stop));
    const controller = new AbortController();

    const loop = runLeaderLoop(lock, start, controller.signal, logger);
    await tick();
    expect(start).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();

    controller.abort();
    await loop;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops the session when the lock is lost, then waits for the lock again", async () => {
    const { lock, waitForLock, loseLock } = fakeLock();
    const stop = vi.fn(() => Promise.resolve());
    const start = vi.fn(() => Promise.resolve(stop));
    const controller = new AbortController();

    const loop = runLeaderLoop(lock, start, controller.signal, logger);
    await tick();
    loseLock();
    await tick();
    expect(stop).toHaveBeenCalledOnce();
    expect(waitForLock).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(2);

    controller.abort();
    await loop;
  });

  it("aborts the startup signal as soon as the lock is lost mid-startup", async () => {
    const { lock, loseLock } = fakeLock();
    const stop = vi.fn(() => Promise.resolve());
    let startupSignal: AbortSignal | undefined;
    let finishStartup: (() => void) | undefined;
    const start = vi.fn((signal: AbortSignal) => {
      if (startupSignal) return Promise.resolve(stop); // later startups finish at once
      startupSignal = signal;
      return new Promise<() => Promise<void>>((resolve) => {
        finishStartup = () => resolve(stop);
      });
    });
    const controller = new AbortController();

    const loop = runLeaderLoop(lock, start, controller.signal, logger);
    await tick();
    expect(startupSignal?.aborted).toBe(false);

    loseLock(); // the lock is lost while startup is still running
    expect(startupSignal?.aborted).toBe(true);

    finishStartup?.();
    await tick();
    expect(stop).toHaveBeenCalled(); // whatever did start is stopped

    controller.abort();
    await loop;
  });

  it("aborts the startup signal on shutdown", async () => {
    const { lock } = fakeLock();
    let startupSignal: AbortSignal | undefined;
    const start = vi.fn((signal: AbortSignal) => {
      startupSignal ??= signal;
      return Promise.resolve(() => Promise.resolve());
    });
    const controller = new AbortController();
    const loop = runLeaderLoop(lock, start, controller.signal, logger);
    await tick();
    controller.abort();
    await loop;
    expect(startupSignal?.aborted).toBe(true);
  });
});
