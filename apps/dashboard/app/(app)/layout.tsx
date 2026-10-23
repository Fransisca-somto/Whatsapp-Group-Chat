import { Suspense } from "react";
import type * as React from "react";

import { AppShell } from "@/components/AppShell";
import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { requireCurrentUser } from "@/server/currentUser";
import { countNeedingAttention } from "@/server/schedule";

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
  // Posts that failed, were skipped or may not have arrived (P18): a count on the Schedule link.
  const attention = await countNeedingAttention();
  return (
    <AppShell
      user={{ displayName: user.displayName, role: user.role }}
      navBadges={{ "/schedule": attention }}
    >
      {children}
    </AppShell>
  );
}
