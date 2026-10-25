import { Users } from "lucide-react";
import Link from "next/link";

import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";

export type WaitingGroup = { id: string; name: string; relinked_at: string };

/**
 * Relink re-admission checklist (overview §4.6, Phase 7, 7.1): after a number change, the groups
 * the new number still has to be added to. Each disappears from the list as the new number is
 * added (the group returns to its earlier status on its own, P38).
 */
export function ReadmissionChecklist({
  groups,
  timeZone,
}: {
  groups: WaitingGroup[];
  timeZone: string;
}) {
  if (groups.length === 0) return null;
  const since = groups.reduce((a, b) => (a.relinked_at < b.relinked_at ? a : b)).relinked_at;
  return (
    <section
      aria-labelledby="readmission-title"
      className="mb-6 rounded-xl border border-status-warn/40 bg-surface p-6"
    >
      <div className="mb-3 flex items-start gap-3">
        <Users aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-status-warn" />
        <div className="flex flex-col gap-1">
          <h2 id="readmission-title" className="text-lg font-semibold">
            Add the new number to {groups.length} {groups.length === 1 ? "group" : "groups"}
          </h2>
          <p className="text-sm text-muted-foreground">
            The number was changed <DateTimeInCompanyTz value={since} timeZone={timeZone} />. In
            WhatsApp, add the bot&apos;s new number to each group below. Each one is active again
            within a minute of being added, with its training and settings, and leaves this list.
          </p>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {groups.map((group) => (
          <li key={group.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <Link href={`/groups/${group.id}`} className="font-medium hover:underline">
              {group.name}
            </Link>
            <span className="text-muted-foreground">Waiting for the new number</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
