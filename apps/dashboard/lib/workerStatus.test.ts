import { describe, expect, it } from "vitest";

import { formatLastSeen, secondsSinceHeartbeat, workerDisplayStatus } from "./workerStatus";

const now = Date.parse("2026-10-18T12:00:00Z");
const ago = (s: number) => new Date(now - s * 1000).toISOString();

describe("workerDisplayStatus", () => {
  it("shows the recorded status while the heartbeat is fresh", () => {
    expect(workerDisplayStatus({ status: "connected", last_heartbeat_at: ago(10) }, now)).toBe(
      "connected",
    );
    expect(workerDisplayStatus({ status: "not_linked", last_heartbeat_at: ago(59) }, now)).toBe(
      "not_linked",
    );
  });

  it("shows offline once the heartbeat is older than 60 s", () => {
    expect(workerDisplayStatus({ status: "connected", last_heartbeat_at: ago(61) }, now)).toBe(
      "offline",
    );
  });

  it("shows offline when the worker never reported or the row is missing", () => {
    expect(workerDisplayStatus({ status: "connected", last_heartbeat_at: null }, now)).toBe(
      "offline",
    );
    expect(workerDisplayStatus(null, now)).toBe("offline");
  });
});

describe("last seen", () => {
  it("counts whole seconds and formats them", () => {
    expect(secondsSinceHeartbeat({ status: "connected", last_heartbeat_at: ago(42) }, now)).toBe(
      42,
    );
    expect(formatLastSeen(null)).toBe("never");
    expect(formatLastSeen(2)).toBe("just now");
    expect(formatLastSeen(42)).toBe("42s ago");
    expect(formatLastSeen(300)).toBe("5 min ago");
    expect(formatLastSeen(7_200)).toBe("2 h ago");
    expect(formatLastSeen(200_000)).toBe("2 d ago");
  });
});
