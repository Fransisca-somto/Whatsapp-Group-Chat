"use client";

import {
  splitTrainingDocument,
  titleFromFileName,
  type TrainingImportResult,
} from "@soft-agent-support/shared";
import { FileText, Loader2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TRAINING_FILE_MAX_BYTES, trainingPreview } from "@/lib/training";
import { importTraining } from "@/server/actions/knowledge";

const ACCEPTED = /\.(txt|md|markdown)$/i;

type Props = { groupId: string; open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Upload a .txt / .md file, review how it was split, then save. The file is read in the browser;
 * nothing is stored until Save.
 */
export function ImportTrainingDialog({ groupId, open, onOpenChange }: Props) {
  const router = useRouter();
  const inputId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<TrainingImportResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setFileName(null);
    setResult(null);
    setSelected(new Set());
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const readFile = async (file: File) => {
    reset();
    if (!ACCEPTED.test(file.name)) {
      setError("Upload a .txt or .md file.");
      return;
    }
    if (file.size > TRAINING_FILE_MAX_BYTES) {
      setError("That file is over 200 KB. Split it into smaller files.");
      return;
    }
    const split = splitTrainingDocument(await file.text(), titleFromFileName(file.name));
    if (split.entries.length === 0) {
      setError("That file has no text to import.");
      return;
    }
    setFileName(file.name);
    setResult(split);
    setSelected(new Set(split.entries.map((_, index) => index)));
  };

  const save = () => {
    if (!result) return;
    const entries = result.entries.filter((_, index) => selected.has(index));
    startTransition(async () => {
      const response = await importTraining({ groupId, entries });
      if (response.ok) {
        toast.success(
          `${response.data.count} ${response.data.count === 1 ? "entry" : "entries"} imported.`,
        );
        reset();
        onOpenChange(false);
        router.refresh();
      } else {
        setError(response.error);
      }
    });
  };

  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <div className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Upload training</DialogTitle>
            <DialogDescription>
              A .txt or .md file, up to 200 KB. Each top heading (# or ##) becomes its own entry;
              smaller headings become subheadings. You can review everything before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>File</Label>
            <input
              id={inputId}
              type="file"
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              disabled={pending}
              className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
          </div>

          {result && (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                <span className="font-medium">{fileName}</span> has {result.entries.length}{" "}
                {result.entries.length === 1 ? "entry" : "entries"}. Untick any you don&apos;t want.
              </p>
              {result.warnings.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-lg border border-status-warn/40 p-3 text-sm">
                  {result.warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-2">
                      <TriangleAlert
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-status-warn"
                      />
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="flex flex-col gap-2">
                {result.entries.map((entry, index) => (
                  <li key={index}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-accent/50">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary"
                        checked={selected.has(index)}
                        onChange={() => toggle(index)}
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
                          {entry.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {trainingPreview(entry.content)}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

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
              type="button"
              disabled={pending || !result || selected.size === 0}
              onClick={save}
            >
              {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
              Save {selected.size > 0 ? selected.size : ""}{" "}
              {selected.size === 1 ? "entry" : "entries"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
