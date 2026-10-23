"use client";

import type { LucideIcon } from "lucide-react";
import { Pencil, RotateCcw, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge, type Status } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  attentionReason,
  kindLabel,
  repeatLabel,
  type SchedulableGroup,
  type ScheduledPostView,
  type ScheduleTab,
} from "@/lib/schedule";
import {
  cancelScheduledPost,
  dismissScheduledPost,
  resendScheduledPost,
} from "@/server/actions/schedule";

import { ScheduledPostDialog } from "./ScheduledPostDialog";

type Props = {
  tab: ScheduleTab;
  posts: ScheduledPostView[];
  groups: SchedulableGroup[];
  timeZone: string;
  /** Hide the group name (the group page already shows it). */
  hideGroup?: boolean;
  empty: { icon: LucideIcon; message: string };
};

/** One list of posts with the actions that fit its tab (P18). */
export function ScheduleList({ tab, posts, groups, timeZone, hideGroup, empty }: Props) {
  const [editing, setEditing] = useState<ScheduledPostView | null>(null);

  if (posts.length === 0) return <EmptyState icon={empty.icon} message={empty.message} />;

  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-xl border bg-surface">
        {posts.map((post) => (
          <PostRow
            key={post.id}
            tab={tab}
            post={post}
            timeZone={timeZone}
            hideGroup={hideGroup}
            onEdit={() => setEditing(post)}
          />
        ))}
      </ul>
      <ScheduledPostDialog
        groups={groups}
        timeZone={timeZone}
        post={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </>
  );
}

function PostRow({
  tab,
  post,
  timeZone,
  hideGroup,
  onEdit,
}: {
  tab: ScheduleTab;
  post: ScheduledPostView;
  timeZone: string;
  hideGroup?: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"cancel" | "resend" | null>(null);
  const [pending, startTransition] = useTransition();
  const repeat = repeatLabel(post, timeZone);
  const reason = tab === "attention" ? attentionReason(post) : "";
  const editable = post.status === "scheduled";
  const status: Status =
    post.sent_late && post.status === "sent" ? "late" : (post.status as Status);

  const run = (
    action: (input: { id: string }) => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) =>
    startTransition(async () => {
      const result = await action({ id: post.id });
      if (result.ok) {
        toast.success(success);
        setConfirm(null);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={status} />
          <span className="font-medium">{kindLabel(post.kind)}</span>
          {!hideGroup && (
            <>
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
              <Link
                href={`/groups/${post.group_id}`}
                className="text-muted-foreground underline-offset-4 hover:underline"
              >
                {post.groups?.name ?? "Group"}
              </Link>
            </>
          )}
        </div>
        <p className="line-clamp-3 text-sm whitespace-pre-wrap">{post.body}</p>
        <p className="text-xs text-muted-foreground">
          {post.status === "sent" && post.sent_at ? "Sent " : "Due "}
          <DateTimeInCompanyTz
            value={post.status === "sent" && post.sent_at ? post.sent_at : post.due_at}
            timeZone={timeZone}
          />
          {repeat && ` · ${repeat}`}
        </p>
        {reason && <p className="text-xs text-status-warn">{reason}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {tab === "upcoming" && editable && (
          <>
            <Button variant="ghost" size="icon" aria-label="Edit post" onClick={onEdit}>
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cancel post"
              onClick={() => setConfirm("cancel")}
            >
              <XCircle aria-hidden="true" />
            </Button>
          </>
        )}
        {tab === "attention" && (
          <>
            <Button variant="outline" disabled={pending} onClick={() => setConfirm("resend")}>
              <RotateCcw aria-hidden="true" />
              Resend
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => run(dismissScheduledPost, "Moved to History.")}
            >
              <X aria-hidden="true" />
              Dismiss
            </Button>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Cancel this post?"
        description={
          post.recurrence_rule
            ? "This ends the series: no more posts will go out for it."
            : "It won't be posted."
        }
        confirmLabel="Cancel post"
        destructive
        pending={pending}
        onConfirm={() => run(cancelScheduledPost, "Post cancelled.")}
      />
      <ConfirmDialog
        open={confirm === "resend"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Resend this post?"
        description={
          post.status === "delivery_uncertain"
            ? "Check the group first: it may already have been posted. If it's missing, the bot posts it within a minute."
            : "The bot posts it within a minute."
        }
        confirmLabel="Resend"
        pending={pending}
        onConfirm={() => run(resendScheduledPost, "It will be posted within a minute.")}
      />
    </li>
  );
}
