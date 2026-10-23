import type { GroupStatus } from "@soft-agent-support/shared";
import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/server/currentUser";

export default function TrainingOverviewPage() {
  return (
    <>
      <PageHeader
        title="Training"
        description="What the bot knows in each group. Each group has its own training; no group sees another's."
      />
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <TrainingOverview />
      </Suspense>
    </>
  );
}

type Summary = {
  id: string;
  name: string;
  status: GroupStatus;
  total: number;
  active: number;
  lastEdited: string | null;
};

/** Groups the bot can be trained for: everything except archived ones. */
const SHOWN_STATUSES: GroupStatus[] = ["active", "paused", "pending", "removed"];

async function TrainingOverview() {
  await requireCurrentUser();
  const supabase = await createClient();
  const [groupsResult, trainingResult, settingsResult] = await Promise.all([
    supabase.from("groups").select("id, name, status").in("status", SHOWN_STATUSES),
    supabase.from("knowledge_entries").select("group_id, is_active, updated_at"),
    supabase.from("company_settings").select("timezone").eq("id", 1).maybeSingle(),
  ]);
  for (const result of [groupsResult, trainingResult]) {
    if (result.error) throw new Error(`Could not load training: ${result.error.message}`);
  }
  const timeZone = settingsResult.data?.timezone ?? "UTC";

  const summaries = new Map<string, Summary>(
    (groupsResult.data ?? []).map((group) => [
      group.id,
      {
        id: group.id,
        name: group.name,
        status: group.status as GroupStatus,
        total: 0,
        active: 0,
        lastEdited: null,
      },
    ]),
  );
  for (const entry of trainingResult.data ?? []) {
    const summary = summaries.get(entry.group_id);
    if (!summary) continue;
    summary.total += 1;
    if (entry.is_active) summary.active += 1;
    if (!summary.lastEdited || entry.updated_at > summary.lastEdited) {
      summary.lastEdited = entry.updated_at;
    }
  }
  const rows = [...summaries.values()].sort(
    (a, b) => Number(a.active > 0) - Number(b.active > 0) || a.name.localeCompare(b.name),
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        message="No groups yet. Add the bot's number to a WhatsApp group and approve it, then train it here."
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/groups/${row.id}?tab=train`}
            className="flex h-full flex-col gap-2 rounded-xl border bg-surface p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-medium">{row.name}</span>
              <StatusBadge status={row.status} />
            </div>
            {row.active === 0 ? (
              <Badge variant="outline">Not trained</Badge>
            ) : (
              <p className="text-sm">
                {row.active} {row.active === 1 ? "entry" : "entries"} in use
                {row.total > row.active && (
                  <span className="text-muted-foreground"> · {row.total - row.active} off</span>
                )}
              </p>
            )}
            {row.lastEdited && (
              <p className="text-xs text-muted-foreground">
                Last edited <DateTimeInCompanyTz value={row.lastEdited} timeZone={timeZone} />
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
