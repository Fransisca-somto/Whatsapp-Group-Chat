import { Settings } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <EmptyState
        icon={Settings}
        message="Company name, timezone and the owner alert phone will be editable here."
      />
    </>
  );
}
