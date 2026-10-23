import { CalendarClock, LayoutDashboard, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { kindLabel, repeatLabel } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/server/currentUser";
import { loadScheduleSummary } from "@/server/schedule";

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" />
      <div className="flex flex-col gap-6">
        <Suspense fallback={null}>
          <AiSetupNotice />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
          <UpcomingPosts />
        </Suspense>
        <EmptyState
          icon={LayoutDashboard}
          message="Worker health and groups will appear here in a later phase."
        />
      </div>
    </>
  );
}

/** Shown until the owner has saved an OpenRouter key and a chat model (ADR-027). */
async function AiSetupNotice() {
  const user = await requireCurrentUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("openrouter_key_hint, ai_chat_model")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.error("AiSetupNotice: read failed", error);
    return null;
  }
  if (data?.openrouter_key_hint && data.ai_chat_model) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-status-warn/40 bg-surface p-4"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-status-warn" />
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">AI not configured</p>
        <p className="text-muted-foreground">
          The bot can&apos;t answer questions until an OpenRouter key and a chat model are saved.{" "}
          {user.role === "owner" ? (
            <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
              Open Settings
            </Link>
          ) : (
            "Ask the owner to set it up in Settings."
          )}
        </p>
      </div>
    </div>
  );
}

/** The next 5 posts and how many need attention (ui-context.md §4 Overview, P20). */
async function UpcomingPosts() {
  await requireCurrentUser();
  const { timeZone, next, attentionCount } = await loadScheduleSummary();

  return (
    <section aria-labelledby="upcoming-title" className="rounded-xl border bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="upcoming-title" className="text-lg font-semibold">
          Upcoming posts
        </h2>
        <Link href="/schedule" className="text-sm text-primary underline-offset-4 hover:underline">
          All reminders &amp; announcements
        </Link>
      </div>
      {attentionCount > 0 && (
        <Link
          href="/schedule?tab=attention"
          className="mb-4 flex items-center gap-2 rounded-lg border border-status-warn/40 p-3 text-sm hover:bg-accent"
        >
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-status-warn" />
          {attentionCount} {attentionCount === 1 ? "post needs" : "posts need"} attention
        </Link>
      )}
      {next.length === 0 ? (
        <EmptyState icon={CalendarClock} message="Nothing scheduled." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {next.map((post) => {
            const repeat = repeatLabel(post, timeZone);
            return (
              <li key={post.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                <p className="truncate text-sm">
                  <span className="font-medium">{kindLabel(post.kind)}</span>
                  <span className="text-muted-foreground"> · {post.groups?.name ?? "Group"}</span>
                </p>
                <p className="truncate text-sm text-muted-foreground">{post.body}</p>
                <p className="text-xs text-muted-foreground">
                  <DateTimeInCompanyTz value={post.due_at} timeZone={timeZone} />
                  {repeat && ` · ${repeat}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
