// What the dashboard shows for the worker (api-interfaces.md §2.2): `offline` when the
// heartbeat is older than 60 s, otherwise the status the worker last recorded. `unknown` when the
// dashboard itself could not read the status (e.g. a network blip to Supabase), so a failed read
// never shows a false "Offline".
import type { WaConnectionStatus } from "@soft-agent-support/shared";

export const OFFLINE_AFTER_MS = 60_000;

export type WorkerConnectionRow = {
  status: string;
  last_heartbeat_at: string | null;
};

export type WorkerDisplayStatus = WaConnectionStatus | "offline" | "unknown";

const KNOWN: readonly string[] = [
  "not_linked",
  "pairing",
  "connecting",
  "connected",
  "reconnecting",
  "logged_out",
  "conflict",
] satisfies WaConnectionStatus[];

export function workerDisplayStatus(
  row: WorkerConnectionRow | null,
  nowMs: number,
  readFailed = false,
): WorkerDisplayStatus {
  if (readFailed) return "unknown";
  const lastSeen = secondsSinceHeartbeat(row, nowMs);
  if (row === null || lastSeen === null || lastSeen * 1000 > OFFLINE_AFTER_MS) return "offline";
  return KNOWN.includes(row.status) ? (row.status as WaConnectionStatus) : "offline";
}

/** Whole seconds since the last heartbeat, or null if the worker never reported. */
export function secondsSinceHeartbeat(row: WorkerConnectionRow | null, nowMs: number) {
  if (!row?.last_heartbeat_at) return null;
  return Math.max(0, Math.floor((nowMs - Date.parse(row.last_heartbeat_at)) / 1000));
}

/** "just now", "42s ago", "5 min ago", "3 h ago", "2 d ago". */
export function formatLastSeen(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}
