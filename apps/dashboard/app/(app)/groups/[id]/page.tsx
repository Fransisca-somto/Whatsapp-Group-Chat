import type { GroupStatus, ReminderPermission } from "@soft-agent-support/shared";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { GROUP_MESSAGE_COLUMNS, GROUP_MESSAGES_PAGE, type GroupMessageView } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/server/currentUser";

import { GroupStatusActions } from "../GroupStatusActions";
import { GroupMessages } from "./GroupMessages";
import { GroupSettingsForm } from "./GroupSettingsForm";

type Props = { params: Promise<{ id: string }> };

export default function GroupPage({ params }: Props) {
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
        <GroupContent params={params} />
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

async function GroupContent({ params }: Props) {
  const { id } = await params;
  await requireCurrentUser();
  const supabase = await createClient();

  const [groupResult, messagesResult, settingsResult] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, status, reminder_permission, ai_enabled, daily_reply_cap, retention_days")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("group_messages")
      .select(GROUP_MESSAGE_COLUMNS)
      .eq("group_id", id)
      .order("sent_at", { ascending: false })
      .limit(GROUP_MESSAGES_PAGE),
    supabase.from("company_settings").select("timezone").eq("id", 1).maybeSingle(),
  ]);
  if (groupResult.error?.code === INVALID_UUID || (!groupResult.error && !groupResult.data)) {
    notFound();
  }
  if (groupResult.error) throw new Error(`Could not load the group: ${groupResult.error.message}`);
  if (messagesResult.error) {
    throw new Error(`Could not load messages: ${messagesResult.error.message}`);
  }

  const group = groupResult.data!;
  const status = group.status as GroupStatus;
  const timeZone = settingsResult.data?.timezone ?? "UTC";

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

      <section aria-labelledby="settings-title" className="rounded-xl border bg-surface p-6">
        <h2 id="settings-title" className="mb-4 text-lg font-semibold">
          Settings
        </h2>
        <GroupSettingsForm
          groupId={group.id}
          defaults={{
            reminderPermission: group.reminder_permission as ReminderPermission,
            aiEnabled: group.ai_enabled,
            dailyReplyCap: group.daily_reply_cap,
            retentionDays: group.retention_days,
          }}
        />
      </section>

      <section aria-labelledby="messages-title" className="rounded-xl border bg-surface p-6">
        <h2 id="messages-title" className="mb-4 text-lg font-semibold">
          Recent messages
        </h2>
        <GroupMessages
          groupId={group.id}
          initial={messagesResult.data as GroupMessageView[]}
          timeZone={timeZone}
        />
      </section>
    </div>
  );
}
