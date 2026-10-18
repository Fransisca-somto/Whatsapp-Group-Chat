"use client";

import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import type * as React from "react";

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

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  /** When set, the confirm button stays disabled until this exact word is typed. */
  confirmWord?: string;
  destructive?: boolean;
  pending?: boolean;
  /** Extra fields shown above the confirmation word (e.g. a phone number). */
  children?: React.ReactNode;
  /** Extra condition for enabling the confirm button. */
  canConfirm?: boolean;
};

/** Required for every destructive action (ui-context.md §1, §5). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  confirmWord,
  destructive = false,
  pending = false,
  children,
  canConfirm = true,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const wordOk = !confirmWord || typed === confirmWord;

  const handleOpenChange = (next: boolean) => {
    if (pending) return; // never close while the action is in progress
    if (!next) setTyped("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (wordOk && canConfirm && !pending) onConfirm();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {children}

          {confirmWord && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={inputId}>
                Type <span className="font-mono font-semibold">{confirmWord}</span> to confirm
              </Label>
              <Input
                id={inputId}
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={!wordOk || !canConfirm || pending}
            >
              {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
