// Reconnect policy (architecture.md §7) as a pure function, so every row of the table is tested.
import { DisconnectReason } from "baileys";

import type { AlertKind, WaConnectionStatus } from "@soft-agent-support/shared";

export type ReconnectDecision =
  | { action: "logout"; status: "logged_out"; alert: "logged_out"; reason: string }
  | { action: "stop"; status: "conflict"; alert: "conflict"; reason: string }
  | {
      action: "reconnect";
      status: Extract<WaConnectionStatus, "connecting" | "reconnecting">;
      delayMs: number;
      /** Whether this disconnect counts toward the consecutive-failure total. */
      countsAsFailure: boolean;
      alert?: Extract<AlertKind, "reconnect_failures">;
      reason: string;
    };

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;
export const FAILURE_ALERT_THRESHOLD = 10;

/** Codes after which the stored session is unusable: clear it and wait for a relink. */
const LOGOUT_CODES = new Map<number, string>([
  [DisconnectReason.loggedOut, "logged out"],
  [DisconnectReason.badSession, "bad session"],
  [DisconnectReason.forbidden, "forbidden (number may be banned)"],
  [DisconnectReason.multideviceMismatch, "multi-device mismatch"],
]);

/**
 * @param statusCode Baileys disconnect status code (undefined when unknown).
 * @param previousFailures Consecutive failed connection attempts before this one.
 * @param random Source of jitter in [0, 1); injectable for tests.
 */
export function decideReconnect(
  statusCode: number | undefined,
  previousFailures: number,
  random: () => number = Math.random,
): ReconnectDecision {
  const logoutReason = statusCode === undefined ? undefined : LOGOUT_CODES.get(statusCode);
  if (logoutReason) {
    return { action: "logout", status: "logged_out", alert: "logged_out", reason: logoutReason };
  }

  if (statusCode === DisconnectReason.connectionReplaced) {
    return {
      action: "stop",
      status: "conflict",
      alert: "conflict",
      reason: "connection replaced by another device",
    };
  }

  if (statusCode === DisconnectReason.restartRequired) {
    // Normal after pairing and occasionally on server request; not a failure.
    return {
      action: "reconnect",
      status: "connecting",
      delayMs: 0,
      countsAsFailure: false,
      reason: "restart required",
    };
  }

  const failures = previousFailures + 1;
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
  // ±20% jitter, never above the cap.
  const jittered = exponential * (0.8 + random() * 0.4);
  return {
    action: "reconnect",
    status: "reconnecting",
    delayMs: Math.round(Math.min(jittered, BACKOFF_MAX_MS)),
    countsAsFailure: true,
    ...(failures === FAILURE_ALERT_THRESHOLD ? { alert: "reconnect_failures" as const } : {}),
    reason: describe(statusCode),
  };
}

function describe(statusCode: number | undefined): string {
  switch (statusCode) {
    case DisconnectReason.connectionLost:
      return "connection lost or timed out";
    case DisconnectReason.connectionClosed:
      return "connection closed";
    case DisconnectReason.unavailableService:
      return "service unavailable";
    case undefined:
      return "unknown disconnect";
    default:
      return `disconnect code ${statusCode}`;
  }
}
