import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the session and role load (ui-context.md §5: skeletons, no full-page spinners). */
export function AppShellSkeleton() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex h-14 items-center gap-3 border-b bg-surface px-4">
        <Skeleton className="h-5 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="flex flex-1">
        <div className="hidden w-60 shrink-0 flex-col gap-2 border-r bg-surface p-3 md:flex">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex-1 p-4 md:p-8">
          <Skeleton className="mb-6 h-8 w-48" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
