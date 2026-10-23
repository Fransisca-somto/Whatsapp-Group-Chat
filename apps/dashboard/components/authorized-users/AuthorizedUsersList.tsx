"use client";

import { formatPhoneForDisplay } from "@soft-agent-support/shared";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { groupsLabel, type AuthorizedUserView, type GroupOption } from "@/lib/authorizedUsers";
import { deleteAuthorizedUser, setAuthorizedUserActive } from "@/server/actions/authorizedUsers";

import { AuthorizedUserDialog } from "./AuthorizedUserDialog";

/** `/authorized-users`: who may set reminders by tagging the bot (P25). */
export function AuthorizedUsersList({
  users,
  groups,
}: {
  users: AuthorizedUserView[];
  groups: GroupOption[];
}) {
  const [editing, setEditing] = useState<AuthorizedUserView | "new" | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          Add person
        </Button>
      </div>
      {users.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          message="No authorized users yet. In groups set to “admins only”, only people you add here can set reminders by tagging the bot."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border bg-surface">
          {users.map((user) => (
            <UserRow key={user.id} user={user} groups={groups} onEdit={() => setEditing(user)} />
          ))}
        </ul>
      )}
      <AuthorizedUserDialog
        groups={groups}
        user={editing === "new" || editing === null ? undefined : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}

function UserRow({
  user,
  groups,
  onEdit,
}: {
  user: AuthorizedUserView;
  groups: GroupOption[];
  onEdit: () => void;
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const setActive = (isActive: boolean) =>
    startTransition(async () => {
      const result = await setAuthorizedUserActive({ id: user.id, isActive });
      if (result.ok) {
        toast.success(
          isActive ? "They can set reminders again." : "They can no longer set reminders.",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteAuthorizedUser({ id: user.id });
      if (result.ok) {
        toast.success("Removed from the list.");
        setDeleteOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{user.display_name}</span>
          {!user.is_active && <Badge variant="outline">Turned off</Badge>}
        </div>
        <p className="font-mono text-sm text-muted-foreground">
          {formatPhoneForDisplay(user.phone_e164)}
        </p>
        <p className="text-xs text-muted-foreground">{groupsLabel(user, groups)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          aria-label={`Allow ${user.display_name} to set reminders`}
          checked={user.is_active}
          disabled={pending}
          onCheckedChange={setActive}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${user.display_name}`}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${user.display_name}`}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Remove ${user.display_name}?`}
        description="They can no longer set reminders by tagging the bot in admins-only groups. Reminders they already set stay scheduled."
        confirmLabel="Remove"
        destructive
        pending={pending}
        onConfirm={remove}
      />
    </li>
  );
}
