"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  formatPhoneForDisplay,
  pairingRequestInputSchema,
  RELINK_CONFIRMATION_WORD,
  type PairingRequestKind,
} from "@soft-agent-support/shared";
import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";
import { PairingCodeCard, type PairingRequestView } from "@/components/PairingCodeCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useWorkerConnection, type WorkerConnection } from "@/lib/useWorkerConnection";
import { formatLastSeen, secondsSinceHeartbeat, workerDisplayStatus } from "@/lib/workerStatus";
import { cancelPairing, requestPairing } from "@/server/actions/connection";

type RequestRow = PairingRequestView & { created_at: string };

type ConnectionPanelProps = {
  initialConnection: WorkerConnection | null;
  initialRequest: RequestRow | null;
  timeZone: string;
};

const phoneFormSchema = pairingRequestInputSchema.pick({ phoneE164: true });
type PhoneForm = { phoneE164: string };

const OPEN = new Set(["requested", "code_issued"]);
/** Finished requests stay on screen this long so the owner sees the outcome. */
const SHOW_FINISHED_MS = 10 * 60_000;

/** Latest pairing request, kept live through Realtime. */
function useLatestPairingRequest(initial: RequestRow | null) {
  const [request, setRequest] = useState<RequestRow | null>(initial);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("connection-page-pairing")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pairing_requests" },
        (payload) => {
          const row = payload.new as RequestRow | undefined;
          if (!row?.id) return;
          setRequest((current) =>
            !current || row.id === current.id || row.created_at >= current.created_at
              ? row
              : current,
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
  return request;
}

export function ConnectionPanel({
  initialConnection,
  initialRequest,
  timeZone,
}: ConnectionPanelProps) {
  const { row, readFailed, now } = useWorkerConnection(initialConnection);
  const request = useLatestPairingRequest(initialRequest);
  const [pending, startTransition] = useTransition();
  const [relinkOpen, setRelinkOpen] = useState(false);
  const [relinkPhone, setRelinkPhone] = useState("");

  const displayStatus = workerDisplayStatus(row, now, readFailed);
  const rawStatus = row?.status ?? "not_linked";
  const lastSeen = formatLastSeen(secondsSinceHeartbeat(row, now));
  const hasOpenRequest = request !== null && OPEN.has(request.status);
  const showRequest =
    request !== null && (hasOpenRequest || now - Date.parse(request.created_at) < SHOW_FINISHED_MS);
  const canLink = !hasOpenRequest && (rawStatus === "not_linked" || rawStatus === "logged_out");
  const canRelink = !hasOpenRequest && !canLink;

  const form = useForm<PhoneForm>({
    resolver: zodResolver(phoneFormSchema),
    defaultValues: { phoneE164: row?.linked_phone_e164 ?? "" },
  });

  const submit = (kind: PairingRequestKind, phoneE164: string, onDone?: () => void) => {
    startTransition(async () => {
      const result = await requestPairing({ kind, phoneE164 });
      if (result.ok) {
        toast.success("Pairing requested. The code will appear here.");
        onDone?.();
      } else {
        toast.error(result.error);
      }
    });
  };

  const cancel = () => {
    if (!request) return;
    startTransition(async () => {
      const result = await cancelPairing({ requestId: request.id });
      if (result.ok) toast.success("Pairing cancelled.");
      else toast.error(result.error);
    });
  };

  const relinkPhoneValid = phoneFormSchema.safeParse({ phoneE164: relinkPhone }).success;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="number-title"
        className="flex flex-col gap-4 rounded-xl border bg-surface p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="number-title" className="text-lg font-semibold">
            WhatsApp number
          </h2>
          <StatusBadge status={displayStatus} />
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Linked number</dt>
            <dd className="font-mono">
              {row?.linked_phone_e164 ? formatPhoneForDisplay(row.linked_phone_e164) : "None"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Worker last seen</dt>
            <dd>{lastSeen}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last connected</dt>
            <dd>
              {row?.last_connected_at ? (
                <DateTimeInCompanyTz value={row.last_connected_at} timeZone={timeZone} />
              ) : (
                "Never"
              )}
            </dd>
          </div>
        </dl>

        {displayStatus === "offline" && (
          <p className="text-sm text-status-warn">
            The worker is offline. Requests made now are handled when it comes back.
          </p>
        )}
        {(rawStatus === "logged_out" || rawStatus === "conflict") && row?.last_error && (
          <p role="alert" className="text-sm text-destructive">
            {rawStatus === "conflict"
              ? "Another device took over this WhatsApp session. Relink to reconnect."
              : `The number was logged out (${row.last_error}). Link it again.`}
          </p>
        )}

        {canLink && (
          <form
            noValidate
            className="flex flex-col gap-2 sm:max-w-sm"
            onSubmit={form.handleSubmit((values) => submit("pair", values.phoneE164))}
          >
            <Label htmlFor="link-phone">Bot phone number</Label>
            <Input
              id="link-phone"
              inputMode="tel"
              placeholder="+234 801 234 5678"
              aria-invalid={form.formState.errors.phoneE164 ? true : undefined}
              {...form.register("phoneE164")}
            />
            {form.formState.errors.phoneE164 && (
              <p className="text-sm text-destructive">{form.formState.errors.phoneE164.message}</p>
            )}
            <Button type="submit" disabled={pending} className="w-fit">
              {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
              Link number
            </Button>
          </form>
        )}

        {canRelink && (
          <div>
            <Button variant="destructive" onClick={() => setRelinkOpen(true)}>
              Relink number
            </Button>
          </div>
        )}
      </section>

      {showRequest && request && (
        <PairingCodeCard
          request={request}
          busy={pending}
          onCancel={cancel}
          onRetry={() =>
            submit(canLink ? "pair" : (request.kind as PairingRequestKind), request.phone_e164)
          }
        />
      )}

      <ConfirmDialog
        open={relinkOpen}
        onOpenChange={setRelinkOpen}
        title="Relink number"
        description="This logs the bot out of WhatsApp and deletes the saved session. The bot is offline until the new code is entered on the phone."
        confirmLabel="Relink"
        confirmWord={RELINK_CONFIRMATION_WORD}
        destructive
        pending={pending}
        canConfirm={relinkPhoneValid}
        onConfirm={() =>
          submit("relink", relinkPhone, () => {
            setRelinkOpen(false);
            setRelinkPhone("");
          })
        }
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="relink-phone">Number to link</Label>
          <Input
            id="relink-phone"
            inputMode="tel"
            placeholder="+234 801 234 5678"
            value={relinkPhone}
            onChange={(event) => setRelinkPhone(event.target.value)}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
