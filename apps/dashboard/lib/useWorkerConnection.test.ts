import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ReadResult = { data: unknown; error: unknown };
const reads: (() => Promise<ReadResult>)[] = [];
const maybeSingle = vi.fn(() =>
  (reads.shift() ?? (() => Promise.resolve({ data: null, error: null })))(),
);
const channel = { on: () => channel, subscribe: () => channel };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    channel: () => channel,
    removeChannel: () => Promise.resolve(),
  }),
}));

const { REFRESH_MS, useWorkerConnection } = await import("./useWorkerConnection");

const ROW = {
  status: "connected",
  linked_phone_e164: "+2348000000000",
  last_heartbeat_at: "2026-10-23T00:00:00Z",
  last_connected_at: "2026-10-22T22:52:38Z",
  last_error: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reads.length = 0;
  maybeSingle.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe("useWorkerConnection", () => {
  it("reports a failed read instead of an empty row, then heals on the next refresh", async () => {
    reads.push(() => Promise.resolve({ data: null, error: { message: "fetch failed" } }));
    reads.push(() => Promise.resolve({ data: ROW, error: null }));
    const { result } = renderHook(() => useWorkerConnection());
    await flush();
    expect(result.current).toMatchObject({ loaded: true, readFailed: true, row: null });

    await act(async () => {
      vi.advanceTimersByTime(REFRESH_MS);
    });
    await flush();
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ readFailed: false, row: ROW });
  });

  it("treats a thrown network error as a failed read", async () => {
    reads.push(() => Promise.reject(new TypeError("fetch failed")));
    const { result } = renderHook(() => useWorkerConnection());
    await flush();
    expect(result.current.readFailed).toBe(true);
  });
});
