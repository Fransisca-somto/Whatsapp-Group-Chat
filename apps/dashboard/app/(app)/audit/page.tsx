import { auditFilterSchema } from "@soft-agent-support/shared";
import { Suspense } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { AUDIT_COLUMNS, AUDIT_PAGE, type AuditRow } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/server/currentUser";

import { AuditFilters } from "./AuditFilters";
import { AuditTable } from "./AuditTable";

type Props = { searchParams: Promise<{ group?: string | string[]; action?: string | string[] }> };

export default function AuditPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Everything the bot did, and every change made in the dashboard. Newest first."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <AuditContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function AuditContent({ searchParams }: Props) {
  const params = await searchParams;
  await requireCurrentUser();
  const parsed = auditFilterSchema.safeParse({
    groupId: first(params.group) ?? null,
    action: first(params.action) ?? null,
  });
  const filter = parsed.success ? parsed.data : { groupId: null, action: null };

  const supabase = await createClient();
  let query = supabase
    .from("bot_actions")
    .select(AUDIT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(AUDIT_PAGE);
  if (filter.groupId) query = query.eq("group_id", filter.groupId);
  if (filter.action) query = query.eq("action", filter.action);

  const [rowsResult, groupsResult, usersResult, settingsResult] = await Promise.all([
    query,
    supabase.from("groups").select("id, name").order("name"),
    supabase.from("dashboard_users").select("user_id, display_name"),
    supabase.from("company_settings").select("timezone").eq("id", 1).maybeSingle(),
  ]);
  for (const result of [rowsResult, groupsResult, usersResult]) {
    if (result.error) throw new Error(`Could not load the audit log: ${result.error.message}`);
  }
  const dashboardNames = Object.fromEntries(
    (usersResult.data ?? []).map((user) => [user.user_id, user.display_name]),
  );

  return (
    <div className="flex flex-col gap-4">
      <AuditFilters groups={groupsResult.data ?? []} filter={filter} />
      <AuditTable
        key={`${filter.groupId ?? ""}:${filter.action ?? ""}`}
        initial={(rowsResult.data ?? []) as AuditRow[]}
        filter={filter}
        dashboardNames={dashboardNames}
        timeZone={settingsResult.data?.timezone ?? "UTC"}
      />
    </div>
  );
}
