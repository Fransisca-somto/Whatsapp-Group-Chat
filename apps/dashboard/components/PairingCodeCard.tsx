"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export type PairingRequestView = {
  id: string;
  kind: string;
  status: string;
  pairing_code: string | null;
  code_expires_at: string | null;
  error: string | null;
  phone_e164: string;
};

type PairingCodeCardProps = {
  request: PairingRequestView;
  onRetry: () => void;
  onCancel: () => void;
  busy?: boolean;
};

/** "ABCD1234" → "ABCD-1234", the way WhatsApp shows it. */
export function formatPairingCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function useSecondsLeft(expiresAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

/** Pairing code with expiry countdown, plus Retry / Cancel (ui-context.md §5). */
export function PairingCodeCard({
  request,
  onRetry,
  onCancel,
  busy = false,
}: PairingCodeCardProps) {
  const secondsLeft = useSecondsLeft(
    request.status === "code_issued" ? request.code_expires_at : null,
  );

  return (
    <section
      aria-labelledby="pairing-code-title"
      className="flex flex-col gap-4 rounded-xl border bg-surface p-6"
      aria-live="polite"
    >
      <h2 id="pairing-code-title" className="text-lg font-semibold">
        {request.kind === "relink" ? "Relink number" : "Link number"}
      </h2>

      {request.status === "requested" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          Waiting for the worker to issue a pairing code…
        </div>
      )}

      {request.status === "code_issued" && request.pairing_code && (
        <>
          <p
            className="font-mono text-4xl font-semibold tracking-widest"
            data-testid="pairing-code"
          >
            {formatPairingCode(request.pairing_code)}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Open WhatsApp on the phone with {request.phone_e164}.</li>
            <li>Go to Settings → Linked devices → Link a device.</li>
            <li>Choose “Link with phone number instead” and enter this code.</li>
          </ol>
          {secondsLeft !== null && (
            <p className="text-sm">
              {secondsLeft > 0
                ? `Code expires in ${secondsLeft}s`
                : "Code expired, waiting for the worker…"}
            </p>
          )}
        </>
      )}

      {request.status === "paired" && (
        <p className="text-sm text-status-ok">Linked. The bot is connected to WhatsApp.</p>
      )}

      {(request.status === "expired" || request.status === "failed") && (
        <p role="alert" className="text-sm text-destructive">
          {request.status === "expired" ? "The pairing code expired." : "Pairing failed."}
          {request.error ? ` ${request.error}` : ""}
        </p>
      )}

      {request.status === "cancelled" && (
        <p className="text-sm text-muted-foreground">Pairing was cancelled.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {(request.status === "requested" || request.status === "code_issued") && (
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        {(request.status === "expired" ||
          request.status === "failed" ||
          request.status === "cancelled") && (
          <Button onClick={onRetry} disabled={busy}>
            {busy && <Loader2 aria-hidden="true" className="animate-spin" />}
            Retry
          </Button>
        )}
      </div>
    </section>
  );
}
