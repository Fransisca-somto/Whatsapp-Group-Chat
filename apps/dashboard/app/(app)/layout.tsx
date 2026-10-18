import { Suspense } from "react";
import type * as React from "react";

import { AppShell } from "@/components/AppShell";
import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { requireCurrentUser } from "@/server/currentUser";

// The session read stays inside <Suspense>: with Cache Components, reading cookies outside a
// boundary is a build error, and a top-level await here would hold every page behind it.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const user = await requireCurrentUser();
  return <AppShell user={{ displayName: user.displayName, role: user.role }}>{children}</AppShell>;
}
