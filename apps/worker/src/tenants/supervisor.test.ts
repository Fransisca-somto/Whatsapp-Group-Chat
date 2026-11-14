import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTenantSupervisor, type StartTenantSession } from "./supervisor.ts";

const logger = pino({ level: "silent" });

function setup(options: { active: string[][]; fail?: Set<string> }) {
  let pass = 0;
  let clock = 0;
  const started: string[] = [];
  const stopped: string[] = [];
  let onChange: (() => void) | null = null;
  const unsubscribe = vi.fn(() => Promise.resolve());

  const startSession: StartTenantSession = (tenantId) => {
    if (options.fail?.has(tenantId)) return Promise.reject(new Error(`${tenantId} broke`));
    started.push(tenantId);
    return Promise.resolve(() => {
      stopped.push(tenantId);
      return Promise.resolve();
    });
  };

  const supervisor = createTenantSupervisor({
    store: {
      listActive: () =>
        Promise.resolve(options.active[Math.min(pass++, options.active.length - 1)] ?? []),
      onChange: (callback) => {
        onChange = callback;
        return unsubscribe;
      },
    },
    startSession,
    logger,
    intervalMs: 60 * 60_000, // passes are driven by the test
    firstRetryMs: 1_000,
    maxRetryMs: 4_000,
    now: () => clock,
  });
  return {
    supervisor,
    started,
    stopped,
    unsubscribe,
    tick: (ms: number) => {
      clock += ms;
    },
    fireChange: () => onChange?.(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("tenant supervisor", () => {
  it("starts a session for every active tenant", async () => {
    const t = setup({ active: [["a", "b"]] });
    await t.supervisor.start();
    expect(t.started).toEqual(["a", "b"]);
    expect(t.supervisor.running()).toEqual(["a", "b"]);
    await t.supervisor.stop();
  });

  it("starts new tenants and stops suspended ones on the next pass", async () => {
    const t = setup({
      active: [
        ["a", "b"],
        ["b", "c"],
      ],
    });
    await t.supervisor.start();
    await t.supervisor.sync();
    expect(t.stopped).toEqual(["a"]);
    expect(t.started).toEqual(["a", "b", "c"]);
    expect(t.supervisor.running().sort()).toEqual(["b", "c"]);
    await t.supervisor.stop();
  });

  it("never starts a running tenant twice, even with overlapping passes", async () => {
    const t = setup({ active: [["a"]] });
    await t.supervisor.start();
    await Promise.all([t.supervisor.sync(), t.supervisor.sync(), t.supervisor.sync()]);
    expect(t.started).toEqual(["a"]);
    await t.supervisor.stop();
  });

  it("a tenant that fails to start does not stop the others, and is retried with a growing delay", async () => {
    const fail = new Set(["bad"]);
    const t = setup({ active: [["bad", "good"]], fail });
    await t.supervisor.start();
    expect(t.supervisor.running()).toEqual(["good"]);

    await t.supervisor.sync(); // still waiting (1 s)
    t.tick(1_000);
    await t.supervisor.sync(); // retried, fails again: next wait 2 s
    t.tick(1_000);
    fail.delete("bad");
    await t.supervisor.sync(); // only 1 s of 2 s waited
    expect(t.supervisor.running()).toEqual(["good"]);
    t.tick(1_000);
    await t.supervisor.sync();
    expect(t.supervisor.running().sort()).toEqual(["bad", "good"]);
    await t.supervisor.stop();
  });

  it("reacts to tenant changes without waiting for the interval", async () => {
    const t = setup({ active: [["a"], ["a", "b"]] });
    await t.supervisor.start();
    t.fireChange();
    await t.supervisor.sync(); // waits for the queued pass, then runs another (no change)
    expect(t.started).toEqual(["a", "b"]);
    await t.supervisor.stop();
  });

  it("stop() stops every session and unsubscribes", async () => {
    const t = setup({ active: [["a", "b"]] });
    await t.supervisor.start();
    await t.supervisor.stop();
    expect(t.stopped.sort()).toEqual(["a", "b"]);
    expect(t.supervisor.running()).toEqual([]);
    expect(t.unsubscribe).toHaveBeenCalled();
  });

  it("keeps current sessions when the tenant list can't be read", async () => {
    let calls = 0;
    const started: string[] = [];
    const supervisor = createTenantSupervisor({
      store: {
        listActive: () =>
          calls++ === 0 ? Promise.resolve(["a"]) : Promise.reject(new Error("network")),
        onChange: () => () => Promise.resolve(),
      },
      startSession: (tenantId) => {
        started.push(tenantId);
        return Promise.resolve(() => Promise.resolve());
      },
      logger,
      intervalMs: 60 * 60_000,
    });
    await supervisor.start();
    await supervisor.sync();
    expect(supervisor.running()).toEqual(["a"]);
    await supervisor.stop();
  });

  it("aborts a session that is still starting when the supervisor stops", async () => {
    let seenSignal: AbortSignal | null = null;
    let release: (() => void) | null = null;
    const supervisor = createTenantSupervisor({
      store: {
        listActive: () => Promise.resolve(["slow"]),
        onChange: () => () => Promise.resolve(),
      },
      startSession: (_tenantId, signal) => {
        seenSignal = signal;
        return new Promise((_resolve, reject) => {
          release = () => reject(new Error("aborted"));
          signal.addEventListener("abort", () => release?.());
        });
      },
      logger,
      intervalMs: 60 * 60_000,
    });
    const starting = supervisor.start();
    await vi.waitFor(() => expect(seenSignal).not.toBeNull());
    await supervisor.stop();
    await starting;
    expect(seenSignal!.aborted).toBe(true);
    expect(supervisor.running()).toEqual([]);
  });
});
