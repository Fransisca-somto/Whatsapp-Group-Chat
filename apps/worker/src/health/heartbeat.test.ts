import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHeartbeat } from "./heartbeat.ts";

const logger = pino({ level: "silent" });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("heartbeat", () => {
  it("stamps immediately, then every 15 s, until stopped", async () => {
    const update = vi.fn(() => Promise.resolve());
    const heartbeat = createHeartbeat({ store: { update }, instanceId: "a", logger });
    await heartbeat.start();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({
      last_heartbeat_at: expect.any(String) as string,
      instance_id: "a",
    });

    await vi.advanceTimersByTimeAsync(45_000);
    expect(update).toHaveBeenCalledTimes(4);

    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(update).toHaveBeenCalledTimes(4);
  });

  it("keeps beating after a failed write", async () => {
    const update = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(undefined);
    const heartbeat = createHeartbeat({ store: { update }, instanceId: "a", logger });
    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(update).toHaveBeenCalledTimes(2);
    heartbeat.stop();
  });
});
