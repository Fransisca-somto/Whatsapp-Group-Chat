import type { GroupStatus, ReminderPermission } from "@soft-agent-support/shared";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GroupScheduleTab } from "@/components/schedule/GroupScheduleTab";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GROUP_MESSAGE_COLUMNS,
  GROUP_MESSAGES_PAGE,
  GROUP_TABS,
  mentionIdFromJid,
  type GroupMessageView,
  type GroupTab,
} from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";
import { TRAINING_COLUMNS, type TrainingEntryView, type TrainingSourceGroup } from "@/lib/training";
import { requireCurrentUser } from "@/server/currentUser";
import { loadSchedule } from "@/server/schedule";

import { GroupStatusActions } from "../GroupStatusActions";
import { GroupMessages } from "./GroupMessages";
import { GroupSettingsForm } from "./GroupSettingsForm";
import { GroupTabs } from "./GroupTabs";
import { TrainTab } from "./TrainTab";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default function GroupPage({ params, searchParams }: Props) {
  return (
    <>
      <Link
        href="/groups"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All groups
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <GroupContent params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const INVALID_UUID = "22P02";

const STATUS_HELP: Record<GroupStatus, string> = {
  pending: "Waiting for approval. Nothing from this group is stored or answered yet.",
  active: "The bot stores messages and answers when tagged.",
  paused: "Messages are still stored, but the bot does not answer or post.",
  removed: "The bot is no longer in this group. Add it back on WhatsApp to approve it again.",
  archived: "Archived. Nothing is stored or answered.",
};

function pickTab(value: string | string[] | undefined): GroupTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return GROUP_TABS.find((known) => known === tab) ?? "settings";
}

async function GroupContent({ params, searchParams }: Props) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  await requireCurrentUser();
  const supabase = await createClient();

  const [
    groupResult,
    messagesResult,
    settingsResult,
    trainingResult,
    otherGroupsResult,
    connectionResult,
    schedule,
  ] = await Promise.all([
    supabase
      .from("groups")
      .select(
        "id, name, status, reminder_permission, ai_enabled, allow_general_knowledge, daily_reply_cap, retention_days, bot_instructions",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("group_messages")
      .select(GROUP_MESSAGE_COLUMNS)
      .eq("group_id", id)
      .order("sent_at", { ascending: false })
      .limit(GROUP_MESSAGES_PAGE),
    supabase
      .from("company_settings")
      .select("timezone, bot_display_name")
      .eq("id", 1)
      .maybeSingle(),
    supabase.from("knowledge_entries").select(TRAINING_COLUMNS).eq("group_id", id).order("title"),
    // Other groups' training sizes, for "Copy from group". Counts only, no content.
    supabase.from("knowledge_entries").select("group_id, groups(name)").neq("group_id", id),
    // The bot's WhatsApp IDs, so "@52055741849776" mentions can show as "@Assistant".
    supabase.from("wa_connection").select("bot_jid, bot_lid").eq("id", 1).maybeSingle(),
    loadSchedule(id),
  ]);
  if (groupResult.error?.code === INVALID_UUID || (!groupResult.error && !groupResult.data)) {
    notFound();
  }
  if (groupResult.error) throw new Error(`Could not load the group: ${groupResult.error.message}`);
  for (const result of [messagesResult, trainingResult, otherGroupsResult]) {
    if (result.error) throw new Error(`Could not load the group: ${result.error.message}`);
  }

  const group = groupResult.data!;
  const status = group.status as GroupStatus;
  const timeZone = settingsResult.data?.timezone ?? "UTC";
  const botName = settingsResult.data?.bot_display_name ?? "Assistant";
  const botMentionIds = [connectionResult.data?.bot_jid, connectionResult.data?.bot_lid]
    .map(mentionIdFromJid)
    .filter((value): value is string => value !== null);
  const entries = (trainingResult.data ?? []) as TrainingEntryView[];
  const activeEntries = entries.filter((entry) => entry.is_active).length;

  const sources = new Map<string, TrainingSourceGroup>();
  for (const row of otherGroupsResult.data ?? []) {
    const current = sources.get(row.group_id);
    if (current) current.entryCount += 1;
    else
      sources.set(row.group_id, {
        id: row.group_id,
        name: row.groups?.name ?? "Group",
        entryCount: 1,
      });
  }
  const sourceGroups = [...sources.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{group.name}</h1>
            <StatusBadge status={status} />
          </div>
          <p className="text-sm text-muted-foreground">{STATUS_HELP[status]}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <GroupStatusActions groupId={group.id} groupName={group.name} status={status} />
        </div>
      </div>

      <GroupTabs
        initialTab={pickTab(tab)}
        badges={{
          train: activeEntries === 0 ? <Badge variant="outline">Not trained</Badge> : undefined,
          scheduled:
            schedule.lists.attention.length > 0 ? (
              <Badge variant="destructive">{schedule.lists.attention.length}</Badge>
            ) : undefined,
        }}
        panels={{
          settings: (
            <section aria-labelledby="settings-title" className="rounded-xl border bg-surface p-6">
              <h2 id="settings-title" className="mb-4 text-lg font-semibold">
                Settings
              </h2>
              <GroupSettingsForm
                groupId={group.id}
                defaults={{
                  reminderPermission: group.reminder_permission as ReminderPermission,
                  aiEnabled: group.ai_enabled,
                  allowGeneralKnowledge: group.allow_general_knowledge,
                  dailyReplyCap: group.daily_reply_cap,
                  retentionDays: group.retention_days,
                }}
              />
            </section>
          ),
          train: (
            <TrainTab
              groupId={group.id}
              groupName={group.name}
              entries={entries}
              sourceGroups={sourceGroups}
              botInstructions={group.bot_instructions}
              timeZone={timeZone}
            />
          ),
          scheduled: (
            <GroupScheduleTab
              groupId={group.id}
              canPost={status === "active" || status === "paused"}
              upcoming={schedule.lists.upcoming}
              attentionCount={schedule.lists.attention.length}
              groups={schedule.groups}
              timeZone={timeZone}
            />
          ),
          messages: (
            <GroupMessages
              groupId={group.id}
              groupName={group.name}
              initial={messagesResult.data as GroupMessageView[]}
              timeZone={timeZone}
              botName={botName}
              botMentionIds={botMentionIds}
            />
          ),
        }}
      />
    </div>
  );
}
