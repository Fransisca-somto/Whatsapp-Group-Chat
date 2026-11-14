import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TenantsList } from "@/components/admin/TenantsList";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { loadTenants } from "@/server/accounts";
import { requireCurrentUser } from "@/server/currentUser";

export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Companies"
        description="Every company on this platform. Each has its own owner, WhatsApp number, groups and data. Only platform admins see this page."
      />
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <AdminContent />
      </Suspense>
    </>
  );
}

async function AdminContent() {
  const user = await requireCurrentUser();
  if (!user.isPlatformAdmin) redirect("/"); // platform admins only (ADR-039)

  const supabase = await createClient();
  const [tenants, settings] = await Promise.all([
    loadTenants(),
    supabase
      .from("company_settings")
      .select("timezone")
      .eq("tenant_id", user.tenantId)
      .maybeSingle(),
  ]);
  return (
    <TenantsList
      tenants={tenants}
      ownTenantId={user.tenantId}
      timeZone={settings.data?.timezone ?? "UTC"}
    />
  );
}
