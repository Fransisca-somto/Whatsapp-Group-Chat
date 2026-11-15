"use client";

import { createOwnerInputSchema, formatPhoneForDisplay } from "@soft-agent-support/shared";
import { Building2, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";
import { EmptyState } from "@/components/EmptyState";
import { ALL_STATUSES, StatusBadge, type Status } from "@/components/StatusBadge";
import { EMPTY_PERSON, PersonFields, type PersonValues } from "@/components/team/PersonFields";
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
import { createOwner, setTenantStatus } from "@/server/actions/admin";

export type TenantRow = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  connection: string | null;
  linkedPhone: string | null;
  staffCount: number;
};

function asStatus(value: string | null): Status {
  return value && (ALL_STATUSES as string[]).includes(value) ? (value as Status) : "unknown";
}

/** `/admin` (platform admins only): every company, plus New owner and suspend / reactivate. */
export function TenantsList({
  tenants,
  ownTenantId,
  timeZone,
}: {
  tenants: TenantRow[];
  ownTenantId: string;
  timeZone: string;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          New owner
        </Button>
      </div>
      {tenants.length === 0 ? (
        <EmptyState icon={Building2} message="No companies yet." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border bg-surface">
          {tenants.map((tenant) => (
            <TenantItem
              key={tenant.id}
              tenant={tenant}
              isOwn={tenant.id === ownTenantId}
              timeZone={timeZone}
            />
          ))}
        </ul>
      )}
      <NewOwnerDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function TenantItem({
  tenant,
  isOwn,
  timeZone,
}: {
  tenant: TenantRow;
  isOwn: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const suspended = tenant.status === "suspended";

  const toggle = () =>
    startTransition(async () => {
      const result = await setTenantStatus({
        tenantId: tenant.id,
        status: suspended ? "active" : "suspended",
      });
      if (result.ok) {
        toast.success(
          suspended ? `${tenant.name} is active again.` : `${tenant.name} is suspended.`,
        );
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{tenant.name}</span>
          {suspended && <StatusBadge status="suspended" />}
          {isOwn && <span className="text-xs text-muted-foreground">(your company)</span>}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          Owner: {tenant.ownerName ?? "—"}
          {tenant.ownerEmail ? ` · ${tenant.ownerEmail}` : ""}
          {` · ${tenant.staffCount} staff`}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge status={asStatus(tenant.connection)} />
          {tenant.linkedPhone && (
            <span className="font-mono">{formatPhoneForDisplay(tenant.linkedPhone)}</span>
          )}
          <span>
            Added <DateTimeInCompanyTz value={tenant.createdAt} timeZone={timeZone} />
          </span>
        </div>
      </div>
      {!isOwn && (
        <Button variant="outline" onClick={() => setConfirmOpen(true)}>
          {suspended ? "Reactivate" : "Suspend"}
        </Button>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={suspended ? `Reactivate ${tenant.name}?` : `Suspend ${tenant.name}?`}
        description={
          suspended
            ? "Its owner and staff can log in again, and its bot reconnects within a minute."
            : "Its owner and staff are shut out of the dashboard and its bot stops within a minute. Nothing is deleted; you can reactivate it later."
        }
        confirmLabel={suspended ? "Reactivate" : "Suspend"}
        destructive={!suspended}
        pending={pending}
        onConfirm={toggle}
      />
    </li>
  );
}

function NewOwnerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open && <NewOwnerForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewOwnerForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const formId = useId();
  const timeZones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const [companyName, setCompanyName] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [person, setPerson] = useState<PersonValues>(EMPTY_PERSON);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const parsed = createOwnerInputSchema.safeParse({ companyName, timezone, ...person });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the details.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createOwner(parsed.data);
      if (result.ok) {
        toast.success(
          "Company created. Share the login email and temporary password with the owner.",
        );
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
        <DialogTitle>New owner</DialogTitle>
        <DialogDescription>
          Creates a new company with its own owner login. The owner links their own WhatsApp number,
          sets their AI key and adds their own staff. They never see other companies.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-company`}>Company name</Label>
        <Input
          id={`${formId}-company`}
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-tz`}>Time zone</Label>
        <Input
          id={`${formId}-tz`}
          list={`${formId}-tz-options`}
          autoComplete="off"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        />
        <datalist id={`${formId}-tz-options`}>
          {timeZones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </div>
      <PersonFields formId={formId} values={person} onChange={setPerson} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          Create company
        </Button>
      </DialogFooter>
    </form>
  );
}
