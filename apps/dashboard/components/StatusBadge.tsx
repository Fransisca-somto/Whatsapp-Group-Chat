import { cn } from "@/lib/utils";

type StatusTone = "ok" | "info" | "warn" | "error" | "neutral";

// ui-context.md §2.2. Every status renders its text label, so color is never the only signal.
const STATUSES = {
  connected: { tone: "ok", label: "Connected" },
  active: { tone: "ok", label: "Active" },
  sent: { tone: "ok", label: "Sent" },
  pairing: { tone: "info", label: "Pairing" },
  connecting: { tone: "info", label: "Connecting" },
  reconnecting: { tone: "info", label: "Reconnecting" },
  pending: { tone: "info", label: "Pending" },
  scheduled: { tone: "info", label: "Scheduled" },
  sending: { tone: "info", label: "Sending" },
  late: { tone: "warn", label: "Late" },
  delivery_uncertain: { tone: "warn", label: "Delivery uncertain" },
  paused: { tone: "warn", label: "Paused" },
  offline: { tone: "error", label: "Offline" },
  logged_out: { tone: "error", label: "Logged out" },
  conflict: { tone: "error", label: "Conflict" },
  failed: { tone: "error", label: "Failed" },
  removed: { tone: "error", label: "Removed" },
  not_linked: { tone: "neutral", label: "Not linked" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  skipped_late: { tone: "neutral", label: "Skipped" },
  archived: { tone: "neutral", label: "Archived" },
  unknown: { tone: "neutral", label: "Unknown" },
} as const satisfies Record<string, { tone: StatusTone; label: string }>;

export type Status = keyof typeof STATUSES;
export const ALL_STATUSES = Object.keys(STATUSES) as Status[];

const TONE_CLASSES: Record<StatusTone, string> = {
  ok: "border-status-ok/30 bg-status-ok/10 text-status-ok",
  info: "border-status-info/30 bg-status-info/10 text-status-info",
  warn: "border-status-warn/30 bg-status-warn/10 text-status-warn",
  error: "border-status-error/30 bg-status-error/10 text-status-error",
  neutral: "border-status-neutral/30 bg-status-neutral/10 text-status-neutral",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const { tone, label } = STATUSES[status];
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
