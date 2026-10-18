import { LayoutDashboard } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" />
      <EmptyState
        icon={LayoutDashboard}
        message="Worker health, groups and upcoming posts will appear here once the worker is connected."
      />
    </>
  );
}
