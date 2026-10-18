import { Users } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function GroupsPage() {
  return (
    <>
      <PageHeader title="Groups" />
      <EmptyState
        icon={Users}
        message="No groups yet. Add the bot's number to a WhatsApp group, then approve it here."
      />
    </>
  );
}
