import type { GroupStatus, ReminderPermission } from "@soft-agent-support/shared";
import { Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { REMINDER_PERMISSION_LABELS } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/server/currentUser";

import { ApproveGroupButton } from "./GroupStatusActions";

export default function GroupsPage() {
  return (
    <>
      <PageHeader
        title="Groups"
        description="WhatsApp groups the bot is in. Approve a group before the bot stores or answers anything there."
      />
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <GroupsContent />
      </Suspense>
    </>
  );
}

type GroupRow = {
  id: string;
  name: string;
  status: GroupStatus;
  reminder_permission: ReminderPermission;
  last_activity_at: string | null;
  /** Set while the group waits for the new number after a relink (7.1). */
  relinked_at: string | null;
};

/** Pending first (they need action), then live groups, then the rest; by name within each. */
const STATUS_ORDER: Record<GroupStatus, number> = {
  pending: 0,
  active: 1,
  paused: 2,
  removed: 3,
  archived: 4,
};

async function GroupsContent() {
  await requireCurrentUser();
  const supabase = await createClient();
  const [groupsResult, settingsResult, trainingResult] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, status, reminder_permission, last_activity_at, relinked_at"),
    supabase.from("company_settings").select("timezone").eq("id", 1).maybeSingle(),
    supabase.from("knowledge_entries").select("group_id").eq("is_active", true),
  ]);
  if (groupsResult.error) throw new Error(`Could not load groups: ${groupsResult.error.message}`);
  if (trainingResult.error) {
    throw new Error(`Could not load training: ${trainingResult.error.message}`);
  }
  const timeZone = settingsResult.data?.timezone ?? "UTC";
  const trainedGroupIds = new Set(trainingResult.data.map((row) => row.group_id));
  /** Live groups without active training: the bot only replies that it is not set up yet. */
  const needsTraining = (group: GroupRow) =>
    (group.status === "active" || group.status === "paused") && !trainedGroupIds.has(group.id);
  const notTrained = (group: GroupRow) =>
    needsTraining(group) && (
      <Link href={`/groups/${group.id}?tab=train`} aria-label={`Train ${group.name}`}>
        <Badge variant="outline">Not trained</Badge>
      </Link>
    );

  /** 7.1: removed after a number change and not yet re-added (see the Connection page). */
  const waitingForNumber = (group: GroupRow) =>
    group.status === "removed" &&
    group.relinked_at && <Badge variant="outline">Waiting for the new number</Badge>;

  const groups = (groupsResult.data as GroupRow[]).sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={Users}
        message="No groups yet. Add the bot's number to a WhatsApp group, then approve it here."
      />
    );
  }

  const lastActivity = (group: GroupRow) =>
    group.last_activity_at ? (
      <DateTimeInCompanyTz value={group.last_activity_at} timeZone={timeZone} />
    ) : (
      <span className="text-muted-foreground">No messages yet</span>
    );

  return (
    <>
      {/* Desktop: table */}
      <div className="hidden rounded-xl border bg-surface md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reminders by tag</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={group.id}>
                <TableCell className="font-medium">
                  <Link href={`/groups/${group.id}`} className="hover:underline">
                    {group.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={group.status} />
                    {notTrained(group)}
                    {waitingForNumber(group)}
                  </div>
                </TableCell>
                <TableCell>{REMINDER_PERMISSION_LABELS[group.reminder_permission]}</TableCell>
                <TableCell>{lastActivity(group)}</TableCell>
                <TableCell className="text-right">
                  {group.status === "pending" && <ApproveGroupButton groupId={group.id} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="flex flex-col gap-3 md:hidden">
        {groups.map((group) => (
          <li key={group.id} className="flex flex-col gap-2 rounded-xl border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/groups/${group.id}`} className="font-medium hover:underline">
                {group.name}
              </Link>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StatusBadge status={group.status} />
                {notTrained(group)}
                {waitingForNumber(group)}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Reminders: {REMINDER_PERMISSION_LABELS[group.reminder_permission]}
            </p>
            <p className="text-sm">{lastActivity(group)}</p>
            {group.status === "pending" && <ApproveGroupButton groupId={group.id} />}
          </li>
        ))}
      </ul>
    </>
  );
}
