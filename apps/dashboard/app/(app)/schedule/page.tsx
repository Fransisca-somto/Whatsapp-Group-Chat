import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function SchedulePage() {
  return (
    <>
      <PageHeader title="Reminders & announcements" />
      <EmptyState
        icon={CalendarClock}
        message="No reminders or announcements yet. Scheduling arrives in a later phase."
      />
    </>
  );
}
