import { DisconnectReason } from "baileys";
import { describe, expect, it } from "vitest";

import { BACKOFF_MAX_MS, decideReconnect } from "./reconnectPolicy.ts";

const noJitter = () => 0.5; // multiplier 1.0

describe("decideReconnect", () => {
  it.each([
    DisconnectReason.loggedOut,
    DisconnectReason.badSession,
    DisconnectReason.forbidden,
    DisconnectReason.multideviceMismatch,
  ])("logs out on code %i without reconnecting", (code) => {
    expect(decideReconnect(code, 0)).toMatchObject({
      action: "logout",
      status: "logged_out",
      alert: "logged_out",
    });
  });

  it("stops with a conflict when the connection is replaced", () => {
    expect(decideReconnect(DisconnectReason.connectionReplaced, 0)).toMatchObject({
      action: "stop",
      status: "conflict",
      alert: "conflict",
    });
  });

  it("reconnects immediately on restart required, without counting a failure", () => {
    expect(decideReconnect(DisconnectReason.restartRequired, 3)).toMatchObject({
      action: "reconnect",
      delayMs: 0,
      countsAsFailure: false,
    });
  });

  it("backs off 2s, 4s, 8s ... capped at 60s", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 10].map(
      (prev) =>
        (decideReconnect(DisconnectReason.connectionLost, prev, noJitter) as { delayMs: number })
          .delayMs,
    );
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it("applies jitter within ±20% and never exceeds the cap", () => {
    const low = decideReconnect(DisconnectReason.connectionLost, 1, () => 0);
    const high = decideReconnect(DisconnectReason.connectionLost, 1, () => 0.999);
    const capped = decideReconnect(DisconnectReason.connectionLost, 20, () => 0.999);
    expect(low).toMatchObject({ delayMs: 3_200 });
    expect((high as { delayMs: number }).delayMs).toBeLessThanOrEqual(4_800);
    expect((capped as { delayMs: number }).delayMs).toBe(BACKOFF_MAX_MS);
  });

  it("treats unknown and other codes as retryable failures", () => {
    for (const code of [undefined, DisconnectReason.connectionClosed, 503, 999]) {
      expect(decideReconnect(code, 0)).toMatchObject({
        action: "reconnect",
        status: "reconnecting",
        countsAsFailure: true,
      });
    }
  });

  it("alerts once, on the 10th consecutive failure", () => {
    expect(decideReconnect(DisconnectReason.connectionLost, 8)).not.toHaveProperty("alert");
    expect(decideReconnect(DisconnectReason.connectionLost, 9)).toMatchObject({
      alert: "reconnect_failures",
    });
    expect(decideReconnect(DisconnectReason.connectionLost, 10)).not.toHaveProperty("alert");
  });
});
