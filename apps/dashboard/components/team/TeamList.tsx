"use client";

import { createStaffInputSchema } from "@soft-agent-support/shared";
import { Loader2, Plus, Trash2, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addStaff, removeStaff } from "@/server/actions/team";

import { EMPTY_PERSON, PersonFields, type PersonValues } from "./PersonFields";

export type TeamMember = {
  userId: string;
  displayName: string;
  role: string;
  email: string | null;
};

/** `/team` (owner only): the owner and their staff; add or remove staff. */
export function TeamList({
  members,
  currentUserId,
}: {
  members: TeamMember[];
  currentUserId: string;
}) {
  const [adding, setAdding] = useState(false);
  const staff = members.filter((member) => member.role === "staff");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          Add staff
        </Button>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-xl border bg-surface">
        {members.map((member) => (
          <MemberRow key={member.userId} member={member} isYou={member.userId === currentUserId} />
        ))}
      </ul>
      {staff.length === 0 && (
        <EmptyState
          icon={UserCog}
          message="No staff yet. Staff can manage groups, training, reminders and authorized users, but not the WhatsApp connection, Settings or this Team page."
        />
      )}
      <AddStaffDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function MemberRow({ member, isYou }: { member: TeamMember; isYou: boolean }) {
  const router = useRouter();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      const result = await removeStaff({ userId: member.userId });
      if (result.ok) {
        toast.success(`${member.displayName} can no longer log in.`);
        setRemoveOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{member.displayName}</span>
          <Badge variant={member.role === "owner" ? "default" : "outline"}>
            {member.role === "owner" ? "Owner" : "Staff"}
          </Badge>
          {isYou && <span className="text-xs text-muted-foreground">(you)</span>}
        </div>
        <p className="truncate text-sm text-muted-foreground">{member.email ?? "—"}</p>
      </div>
      {member.role === "staff" && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${member.displayName}`}
          onClick={() => setRemoveOpen(true)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      )}
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${member.displayName}?`}
        description="Their login is deleted and they can no longer open the dashboard. Reminders and training they added stay."
        confirmLabel="Remove"
        destructive
        pending={pending}
        onConfirm={remove}
      />
    </li>
  );
}

function AddStaffDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open && <AddStaffForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AddStaffForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const formId = useId();
  const [values, setValues] = useState<PersonValues>(EMPTY_PERSON);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const parsed = createStaffInputSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the details.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addStaff(parsed.data);
      if (result.ok) {
        toast.success("Added. Share the login email and temporary password with them.");
        onDone();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add staff</DialogTitle>
        <DialogDescription>
          Staff log in to this dashboard for your company only. They can manage groups, training,
          reminders and authorized users, but not the WhatsApp connection, Settings or the team.
        </DialogDescription>
      </DialogHeader>
      <PersonFields formId={formId} values={values} onChange={setValues} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          Add staff
        </Button>
      </DialogFooter>
    </form>
  );
}
