import type * as React from "react";

import { cn } from "@/lib/utils";

// Hand-written to match shadcn/ui's skeleton (ADR-022).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
