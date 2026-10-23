import "server-only";

import { ATTENTION_STATUSES } from "@soft-agent-support/shared";

import {
  SCHEDULE_LIST_LIMIT,
  SCHEDULED_POST_COLUMNS,
  type SchedulableGroup,
  type ScheduledPostView,
  type ScheduleTab,
} from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The three lists on `/schedule` (and the group page's Scheduled tab), read through RLS.
 * Upcoming: soonest first. Needs attention and History: newest first.
 */
export async function loadSchedule(groupId: string | null): Promise<{
  groupFilter: string | null;
  filterGroups: { id: string; name: string }[];
  groups: SchedulableGroup[];
  timeZone: string;
  lists: Record<ScheduleTab, ScheduledPostView[]>;
}> {
  const supabase = await createClient();
  const groupFilter = groupId && UUID.test(groupId) ? groupId : null;

  const posts = () => {
    const query = supabase.from("scheduled_posts").select(SCHEDULED_POST_COLUMNS);
    return groupFilter ? query.eq("group_id", groupFilter) : query;
  };
  const [groupsResult, settingsResult, upcoming, attention, history] = await Promise.all([
    supabase.from("groups").select("id, name, status").neq("status", "pending").order("name"),
    supabase.from("company_settings").select("timezone").eq("id", 1).maybeSingle(),
    posts()
      .in("status", ["scheduled", "sending"])
      .order("due_at", { ascending: true })
      .limit(SCHEDULE_LIST_LIMIT),
    posts()
      .in("status", [...ATTENTION_STATUSES])
      .is("dismissed_at", null)
      .order("due_at", { ascending: false })
      .limit(SCHEDULE_LIST_LIMIT),
    posts()
      .or("status.in.(sent,cancelled),dismissed_at.not.is.null")
      .order("due_at", { ascending: false })
      .limit(SCHEDULE_LIST_LIMIT),
  ]);
  for (const result of [groupsResult, upcoming, attention, history]) {
    if (result.error) throw new Error(`Could not load the schedule: ${result.error.message}`);
  }

  const allGroups = groupsResult.data ?? [];
  return {
    groupFilter,
    filterGroups: allGroups.map(({ id, name }) => ({ id, name })),
    groups: allGroups.filter((g) => g.status === "active" || g.status === "paused"),
    timeZone: settingsResult.data?.timezone ?? "UTC",
    lists: {
      upcoming: (upcoming.data ?? []) as ScheduledPostView[],
      attention: (attention.data ?? []) as ScheduledPostView[],
      history: (history.data ?? []) as ScheduledPostView[],
    },
  };
}

/** Overview: the next few posts and how many need attention. */
export async function loadScheduleSummary(limit = 5): Promise<{
  timeZone: string;
  next: ScheduledPostView[];
  attentionCount: number;
}> {
  const supabase = await createClient();
  const [settingsResult, next, attention] = await Promise.all([
    supabase.from("company_settings").select("timezone").eq("id", 1).maybeSingle(),
    supabase
      .from("scheduled_posts")
      .select(SCHEDULED_POST_COLUMNS)
      .eq("status", "scheduled")
      .order("due_at", { ascending: true })
      .limit(limit),
    countNeedingAttention(),
  ]);
  if (next.error) throw new Error(`Could not load the schedule: ${next.error.message}`);
  return {
    timeZone: settingsResult.data?.timezone ?? "UTC",
    next: (next.data ?? []) as ScheduledPostView[],
    attentionCount: attention,
  };
}

/** For the sidebar badge and the Overview; 0 if it can't be read. */
export async function countNeedingAttention(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .in("status", [...ATTENTION_STATUSES])
    .is("dismissed_at", null);
  if (error) {
    console.error("countNeedingAttention: read failed", error);
    return 0;
  }
  return count ?? 0;
}
