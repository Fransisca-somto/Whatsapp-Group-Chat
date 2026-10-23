"use client";

import { CalendarClock, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { SchedulableGroup, ScheduledPostView } from "@/lib/schedule";

import { ScheduleList } from "./ScheduleList";
import { ScheduledPostDialog } from "./ScheduledPostDialog";

/** The group page's Scheduled tab (P20): this group's upcoming posts. */
export function GroupScheduleTab({
  groupId,
  canPost,
  upcoming,
  attentionCount,
  groups,
  timeZone,
}: {
  groupId: string;
  /** Active or paused: the bot can post here. */
  canPost: boolean;
  upcoming: ScheduledPostView[];
  attentionCount: number;
  groups: SchedulableGroup[];
  timeZone: string;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <section aria-labelledby="scheduled-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="scheduled-title" className="text-lg font-semibold">
            Upcoming posts
          </h2>
          <p className="text-sm text-muted-foreground">
            Reminders and announcements the bot will post in this group.{" "}
            <Link
              href={`/schedule?group=${groupId}${attentionCount > 0 ? "&tab=attention" : ""}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {attentionCount > 0
                ? `${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`
                : "History and more"}
            </Link>
          </p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={!canPost}>
          <Plus aria-hidden="true" />
          New post
        </Button>
      </div>
      <ScheduleList
        tab="upcoming"
        posts={upcoming}
        groups={groups}
        timeZone={timeZone}
        hideGroup
        empty={{
          icon: CalendarClock,
          message: canPost
            ? "Nothing scheduled for this group."
            : "The bot can only post in active or paused groups.",
        }}
      />
      <ScheduledPostDialog
        groups={groups}
        timeZone={timeZone}
        defaultGroupId={groupId}
        open={creating}
        onOpenChange={setCreating}
      />
    </section>
  );
}
