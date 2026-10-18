import { ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function AuthorizedUsersPage() {
  return (
    <>
      <PageHeader title="Authorized users" />
      <EmptyState
        icon={ShieldCheck}
        message="No authorized users yet. People allowed to create reminders by tagging the bot will be listed here."
      />
    </>
  );
}
