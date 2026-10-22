"use client";

import type { AuditFilter } from "@soft-agent-support/shared";
import { usePathname, useRouter } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ACTION_LABELS } from "@/lib/audit";

const ALL = "all";

/** Group and action filters, kept in the URL (`?group=…&action=…`). */
export function AuditFilters({
  groups,
  filter,
}: {
  groups: { id: string; name: string }[];
  filter: AuditFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const groupLabels: Record<string, string> = {
    [ALL]: "All groups",
    ...Object.fromEntries(groups.map((group) => [group.id, group.name])),
  };
  const actionLabels: Record<string, string> = { [ALL]: "All actions", ...ACTION_LABELS };

  const apply = (next: Partial<AuditFilter>) => {
    const merged = { ...filter, ...next };
    const params = new URLSearchParams();
    if (merged.groupId) params.set("group", merged.groupId);
    if (merged.action) params.set("action", merged.action);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Select
        items={groupLabels}
        value={filter.groupId ?? ALL}
        onValueChange={(value) => apply({ groupId: value === ALL ? null : value })}
      >
        <SelectTrigger aria-label="Filter by group" className="sm:w-56" />
        <SelectContent>
          {Object.entries(groupLabels).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={actionLabels}
        value={filter.action ?? ALL}
        onValueChange={(value) => apply({ action: value === ALL ? null : value })}
      >
        <SelectTrigger aria-label="Filter by action" className="sm:w-56" />
        <SelectContent>
          {Object.entries(actionLabels).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
