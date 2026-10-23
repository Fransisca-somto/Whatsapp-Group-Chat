"use client";

import { upsertAuthorizedUserInputSchema } from "@soft-agent-support/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { PhoneInput } from "@/components/PhoneInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AuthorizedUserView, GroupOption } from "@/lib/authorizedUsers";
import { upsertAuthorizedUser } from "@/server/actions/authorizedUsers";

type Props = {
  groups: GroupOption[];
  /** The person to edit; omit to add someone. */
  user?: AuthorizedUserView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Add or edit one authorized user (ui-context.md §4 `/authorized-users`). */
export function AuthorizedUserDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {props.open && <UserForm key={props.user?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function UserForm({ groups, user, onOpenChange }: Props) {
  const router = useRouter();
  const formId = useId();
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [phone, setPhone] = useState(user?.phone_e164 ?? "");
  const [allGroups, setAllGroups] = useState(user?.all_groups ?? true);
  const [groupIds, setGroupIds] = useState<string[]>(
    user?.authorized_user_groups.map((link) => link.group_id) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleGroup = (id: string, on: boolean) =>
    setGroupIds((current) => (on ? [...current, id] : current.filter((g) => g !== id)));

  const save = () => {
    const parsed = upsertAuthorizedUserInputSchema.safeParse({
      id: user?.id,
      displayName,
      phoneE164: phone,
      allGroups,
      groupIds: allGroups ? [] : groupIds,
      isActive: user?.is_active ?? true,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the details.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await upsertAuthorizedUser(parsed.data);
      if (result.ok) {
        toast.success(
          user ? "Changes saved." : "Added. They can set reminders by tagging the bot.",
        );
        onOpenChange(false);
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
        <DialogTitle>{user ? "Edit authorized user" : "Add authorized user"}</DialogTitle>
        <DialogDescription>
          In groups set to &ldquo;admins only&rdquo;, only people on this list can set reminders by
          tagging the bot. They are matched by their WhatsApp number.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-name`}>Name</Label>
        <Input
          id={`${formId}-name`}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-phone`}>WhatsApp number</Label>
        <PhoneInput id={`${formId}-phone`} value={phone} onChange={setPhone} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-all`}>All groups</Label>
          <p className="text-xs text-muted-foreground">
            Turn off to allow only the groups you pick.
          </p>
        </div>
        <Switch id={`${formId}-all`} checked={allGroups} onCheckedChange={setAllGroups} />
      </div>

      {!allGroups && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Groups</legend>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approved groups yet.</p>
          ) : (
            groups.map((group) => (
              <label key={group.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={groupIds.includes(group.id)}
                  onChange={(event) => toggleGroup(group.id, event.target.checked)}
                />
                {group.name}
              </label>
            ))
          )}
        </fieldset>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {user ? "Save changes" : "Add"}
        </Button>
      </DialogFooter>
    </form>
  );
}
