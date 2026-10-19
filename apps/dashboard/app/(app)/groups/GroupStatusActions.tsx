"use client";

import {
  availableGroupActions,
  type GroupAction,
  type GroupStatus,
} from "@soft-agent-support/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { GROUP_ACTION_LABELS } from "@/lib/groups";
import { changeGroupStatus } from "@/server/actions/groups";

const SUCCESS: Record<GroupAction, string> = {
  approve: "Group approved. The bot starts storing its messages within 30 seconds.",
  pause: "Group paused. Messages are still stored; the bot stays quiet.",
  resume: "Group resumed.",
  archive: "Group archived.",
};

function useGroupAction(groupId: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: GroupAction, onDone?: () => void) => {
    startTransition(async () => {
      const result = await changeGroupStatus({ groupId, action });
      if (result.ok) {
        toast.success(SUCCESS[action]);
        onDone?.();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };
  return { pending, run };
}

/** The Approve button on pending rows of the groups list. */
export function ApproveGroupButton({ groupId }: { groupId: string }) {
  const { pending, run } = useGroupAction(groupId);
  return (
    <Button size="sm" disabled={pending} onClick={() => run("approve")}>
      {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
      Approve
    </Button>
  );
}

/** Status buttons on the group page. Archive asks for confirmation (ui-context.md §1). */
export function GroupStatusActions({
  groupId,
  groupName,
  status,
}: {
  groupId: string;
  groupName: string;
  status: GroupStatus;
}) {
  const { pending, run } = useGroupAction(groupId);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const actions = availableGroupActions(status);
  if (actions.length === 0) return null;

  return (
    <>
      {actions.map((action) =>
        action === "archive" ? (
          <Button
            key={action}
            variant="outline"
            disabled={pending}
            onClick={() => setArchiveOpen(true)}
          >
            Archive
          </Button>
        ) : (
          <Button
            key={action}
            variant={action === "approve" ? "default" : "outline"}
            disabled={pending}
            onClick={() => run(action)}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {GROUP_ACTION_LABELS[action]}
          </Button>
        ),
      )}
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive “${groupName}”?`}
        description="The bot stops storing and answering in this group, and it can't be un-archived from the dashboard. Messages already stored are kept."
        confirmLabel="Archive"
        destructive
        pending={pending}
        onConfirm={() => run("archive", () => setArchiveOpen(false))}
      />
    </>
  );
}
