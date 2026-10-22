"use client";

import type { AuditFilter } from "@soft-agent-support/shared";
import { Loader2, ScrollText } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { actionLabel, auditActor, auditSummary, AUDIT_PAGE, type AuditRow } from "@/lib/audit";
import { loadAuditPage } from "@/server/actions/audit";

/** Audit rows newest first, 50 at a time; a table on desktop, cards on mobile. */
export function AuditTable({
  initial,
  filter,
  dashboardNames,
  timeZone,
}: {
  initial: AuditRow[];
  filter: AuditFilter;
  dashboardNames: Record<string, string>;
  timeZone: string;
}) {
  const [rows, setRows] = useState(initial);
  const [hasMore, setHasMore] = useState(initial.length === AUDIT_PAGE);
  const [pending, startTransition] = useTransition();

  const loadOlder = () => {
    const oldest = rows.at(-1);
    if (!oldest) return;
    startTransition(async () => {
      const result = await loadAuditPage({ ...filter, before: oldest.created_at });
      if (result.ok) {
        setRows((current) => [...current, ...result.data]);
        setHasMore(result.data.length === AUDIT_PAGE);
      } else {
        toast.error(result.error);
      }
    });
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        message={
          filter.groupId || filter.action
            ? "Nothing matches these filters."
            : "No bot actions yet. Every action the bot takes will be logged here."
        }
      />
    );
  }

  const groupName = (row: AuditRow) => row.groups?.name ?? (row.group_id ? "Deleted group" : "—");

  return (
    <div className="flex flex-col gap-4">
      {/* Desktop: table */}
      <div className="hidden rounded-xl border bg-surface md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">
                  <DateTimeInCompanyTz value={row.created_at} timeZone={timeZone} />
                </TableCell>
                <TableCell>{groupName(row)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {auditActor(row, dashboardNames)}
                </TableCell>
                <TableCell className="font-medium">{actionLabel(row.action)}</TableCell>
                <TableCell className="text-muted-foreground">{auditSummary(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1 rounded-xl border bg-surface p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="font-medium">{actionLabel(row.action)}</span>
              <DateTimeInCompanyTz
                value={row.created_at}
                timeZone={timeZone}
                className="text-xs text-muted-foreground"
              />
            </div>
            <p className="text-muted-foreground">
              {groupName(row)} · {auditActor(row, dashboardNames)}
            </p>
            {auditSummary(row) && <p>{auditSummary(row)}</p>}
          </li>
        ))}
      </ul>

      {hasMore && (
        <Button
          variant="outline"
          className="w-fit self-center"
          disabled={pending}
          onClick={loadOlder}
        >
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          Load older
        </Button>
      )}
    </div>
  );
}
