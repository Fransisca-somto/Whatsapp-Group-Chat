import { ScrollText } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function AuditPage() {
  return (
    <>
      <PageHeader title="Audit log" />
      <EmptyState
        icon={ScrollText}
        message="No bot actions yet. Every action the bot takes will be logged here."
      />
    </>
  );
}
