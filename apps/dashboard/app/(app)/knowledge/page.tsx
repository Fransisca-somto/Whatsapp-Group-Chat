import { BookOpen } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function KnowledgePage() {
  return (
    <>
      <PageHeader title="Knowledge" />
      <EmptyState
        icon={BookOpen}
        message="No knowledge entries yet. Company knowledge the bot uses to answer questions will be managed here."
      />
    </>
  );
}
