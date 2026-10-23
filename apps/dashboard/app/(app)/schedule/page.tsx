import { Suspense } from "react";

import { PageHeader } from "@/components/PageHeader";
import { ScheduleView } from "@/components/schedule/ScheduleView";
import { Skeleton } from "@/components/ui/skeleton";
import { loadSchedule } from "@/server/schedule";
import { SCHEDULE_TABS, type ScheduleTab } from "@/lib/schedule";
import { requireCurrentUser } from "@/server/currentUser";

type Props = { searchParams: Promise<{ tab?: string | string[]; group?: string | string[] }> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function SchedulePage({ searchParams }: Props) {
  return (
    <>
      <PageHeader
        title="Reminders & announcements"
        description="The bot posts these in the group at the set time, on its own."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <ScheduleContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ScheduleContent({ searchParams }: Props) {
  const params = await searchParams;
  await requireCurrentUser();
  const tab = first(params.tab);
  const initialTab: ScheduleTab = SCHEDULE_TABS.find((known) => known === tab) ?? "upcoming";
  const data = await loadSchedule(first(params.group) ?? null);

  return (
    <ScheduleView
      initialTab={initialTab}
      groupFilter={data.groupFilter}
      filterGroups={data.filterGroups}
      groups={data.groups}
      timeZone={data.timeZone}
      lists={data.lists}
    />
  );
}
