import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/PageHeader";
import { TeamList } from "@/components/team/TeamList";
import { Skeleton } from "@/components/ui/skeleton";
import { loadTeam } from "@/server/accounts";
import { requireCurrentUser } from "@/server/currentUser";

export default function TeamPage() {
  return (
    <>
      <PageHeader
        title="Team"
        description="Who can log in to this dashboard for your company. You are the owner; add staff to help with groups, training and reminders."
      />
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <TeamContent />
      </Suspense>
    </>
  );
}

async function TeamContent() {
  const user = await requireCurrentUser();
  if (user.role !== "owner") redirect("/"); // owner only (ui-context.md §4)
  const members = await loadTeam(user.tenantId);
  return <TeamList members={members} currentUserId={user.userId} />;
}
