"use client";

import { CalendarClock, CircleCheck, History, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import {
  SCHEDULE_TAB_LABELS,
  SCHEDULE_TABS,
  type SchedulableGroup,
  type ScheduledPostView,
  type ScheduleTab,
} from "@/lib/schedule";

import { ScheduleList } from "./ScheduleList";
import { ScheduledPostDialog } from "./ScheduledPostDialog";

const ALL_GROUPS = "all";

const EMPTY: Record<ScheduleTab, { icon: typeof CalendarClock; message: string }> = {
  upcoming: {
    icon: CalendarClock,
    message: "Nothing scheduled. Use New post to schedule a reminder or announcement.",
  },
  attention: {
    icon: CircleCheck,
    message:
      "Nothing needs attention. Posts that fail, are skipped or may not have arrived show here.",
  },
  history: { icon: History, message: "No sent or cancelled posts yet." },
};

/** `/schedule`: tabs kept in `?tab=`, group filter in `?group=` (ui-context.md §4). */
export function ScheduleView({
  initialTab,
  groupFilter,
  filterGroups,
  groups,
  timeZone,
  lists,
}: {
  initialTab: ScheduleTab;
  groupFilter: string | null;
  /** Every approved group, for the filter. */
  filterGroups: { id: string; name: string }[];
  /** Groups a post can go to (active or paused). */
  groups: SchedulableGroup[];
  timeZone: string;
  lists: Record<ScheduleTab, ScheduledPostView[]>;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const filterLabels: Record<string, string> = {
    [ALL_GROUPS]: "All groups",
    ...Object.fromEntries(filterGroups.map((g) => [g.id, g.name])),
  };

  const setFilter = (value: string | null) => {
    const url = new URL(window.location.href);
    if (!value || value === ALL_GROUPS) url.searchParams.delete("group");
    else url.searchParams.set("group", value);
    router.push(`${url.pathname}${url.search}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2 sm:w-64">
          <Label htmlFor="schedule-group-filter">Group</Label>
          <Select items={filterLabels} value={groupFilter ?? ALL_GROUPS} onValueChange={setFilter}>
            <SelectTrigger id="schedule-group-filter" />
            <SelectContent>
              {Object.keys(filterLabels).map((value) => (
                <SelectItem key={value} value={value}>
                  {filterLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setCreating(true)} disabled={groups.length === 0}>
          <Plus aria-hidden="true" />
          New post
        </Button>
      </div>
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Approve a group first: the bot can only post in active or paused groups.
        </p>
      )}

      <Tabs
        key={initialTab}
        defaultValue={initialTab}
        onValueChange={(value: ScheduleTab) => {
          const url = new URL(window.location.href);
          url.searchParams.set("tab", value);
          window.history.replaceState(window.history.state, "", url);
        }}
      >
        <TabsList>
          {SCHEDULE_TABS.map((tab) => (
            <TabsTab key={tab} value={tab}>
              {SCHEDULE_TAB_LABELS[tab]}
              {tab === "attention" && lists.attention.length > 0 && (
                <Badge variant="destructive">{lists.attention.length}</Badge>
              )}
            </TabsTab>
          ))}
        </TabsList>
        {SCHEDULE_TABS.map((tab) => (
          <TabsPanel key={tab} value={tab}>
            <ScheduleList
              tab={tab}
              posts={lists[tab]}
              groups={groups}
              timeZone={timeZone}
              empty={EMPTY[tab]}
            />
          </TabsPanel>
        ))}
      </Tabs>

      <ScheduledPostDialog
        groups={groups}
        timeZone={timeZone}
        defaultGroupId={groupFilter ?? undefined}
        open={creating}
        onOpenChange={setCreating}
      />
    </div>
  );
}
