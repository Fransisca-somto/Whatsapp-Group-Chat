import type { LucideIcon } from "lucide-react";
import type * as React from "react";

type EmptyStateProps = {
  icon: LucideIcon;
  message: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon: Icon, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-surface px-6 py-12 text-center">
      <Icon aria-hidden="true" className="size-8 text-muted-foreground" />
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}
