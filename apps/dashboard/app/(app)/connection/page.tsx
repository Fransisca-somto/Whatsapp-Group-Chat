import { Smartphone } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function ConnectionPage() {
  return (
    <>
      <PageHeader title="Connection" />
      <EmptyState
        icon={Smartphone}
        message="The bot's WhatsApp number is not linked yet. Linking and relinking arrive with the worker."
      />
    </>
  );
}
