import type * as React from "react";

import { cn } from "@/lib/utils";

// Hand-written to match shadcn/ui's Base UI label, which is a styled native <label> (ADR-022).
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
