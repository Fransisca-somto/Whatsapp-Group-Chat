import { Suspense } from "react";

import { AuthorizedUsersList } from "@/components/authorized-users/AuthorizedUsersList";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { AUTHORIZED_USER_COLUMNS, type AuthorizedUserView } from "@/lib/authorizedUsers";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/server/currentUser";

export default function AuthorizedUsersPage() {
  return (
    <>
      <PageHeader
        title="Authorized users"
        description="People who can set reminders by tagging the bot in groups set to “admins only”. Each group's Settings tab chooses admins only or any member."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <AuthorizedUsersContent />
      </Suspense>
    </>
  );
}

async function AuthorizedUsersContent() {
  await requireCurrentUser();
  const supabase = await createClient();
  const [usersResult, groupsResult] = await Promise.all([
    supabase.from("authorized_users").select(AUTHORIZED_USER_COLUMNS).order("display_name"),
    supabase.from("groups").select("id, name").neq("status", "pending").order("name"),
  ]);
  for (const result of [usersResult, groupsResult]) {
    if (result.error) throw new Error(`Could not load authorized users: ${result.error.message}`);
  }
  return (
    <AuthorizedUsersList
      users={(usersResult.data ?? []) as AuthorizedUserView[]}
      groups={groupsResult.data ?? []}
    />
  );
}
