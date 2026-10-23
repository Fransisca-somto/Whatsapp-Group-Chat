"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useWorkerConnection } from "@/lib/useWorkerConnection";
import { formatLastSeen, secondsSinceHeartbeat, workerDisplayStatus } from "@/lib/workerStatus";

import { StatusBadge } from "./StatusBadge";

/** Live worker indicator for the top bar (ui-context.md §5): badge + "last seen Xs ago". */
export function WorkerStatus() {
  const { row, loaded, readFailed, now } = useWorkerConnection();
  if (!loaded) return <Skeleton className="h-5 w-24 rounded-full" />;

  const status = workerDisplayStatus(row, now, readFailed);
  const lastSeen = readFailed
    ? "Can't check right now"
    : `Last seen ${formatLastSeen(secondsSinceHeartbeat(row, now))}`;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <span className="sr-only">Worker status:</span>
      <StatusBadge status={status} />
      <span className="hidden text-xs text-muted-foreground lg:inline">{lastSeen}</span>
    </div>
  );
}
