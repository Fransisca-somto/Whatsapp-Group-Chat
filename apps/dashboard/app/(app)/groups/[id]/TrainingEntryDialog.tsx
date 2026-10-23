"use client";

import {
  contentFromSections,
  sectionsFromContent,
  TRAINING_CONTENT_MAX,
  trainingEntryInputSchema,
  type TrainingSection,
} from "@soft-agent-support/shared";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { TrainingEntryView } from "@/lib/training";
import { upsertTrainingEntry } from "@/server/actions/knowledge";

type Props = {
  groupId: string;
  /** The entry to edit; omit to add a new one. */
  entry?: TrainingEntryView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Add or edit one training entry: a heading, then subheadings with their details. */
export function TrainingEntryDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        {/* Remount per entry so the form always starts from that entry's saved text. */}
        {props.open && <EntryForm key={props.entry?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({ groupId, entry, onOpenChange }: Props) {
  const router = useRouter();
  const formId = useId();
  const [title, setTitle] = useState(entry?.title ?? "");
  const [sections, setSections] = useState<TrainingSection[]>(() =>
    entry ? sectionsFromContent(entry.content) : [{ subheading: "", body: "" }],
  );
  const [isActive, setIsActive] = useState(entry?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const content = contentFromSections(sections);
  const overLimit = content.length > TRAINING_CONTENT_MAX;

  const updateSection = (index: number, change: Partial<TrainingSection>) =>
    setSections((current) =>
      current.map((section, i) => (i === index ? { ...section, ...change } : section)),
    );

  const save = () => {
    const parsed = trainingEntryInputSchema.safeParse({ title, content });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the entry.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await upsertTrainingEntry({
        ...parsed.data,
        id: entry?.id,
        groupId,
        isActive,
      });
      if (result.ok) {
        toast.success(
          entry ? "Training updated." : "Training added. The bot uses it from the next question.",
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
        <DialogTitle>{entry ? "Edit training" : "Add training"}</DialogTitle>
        <DialogDescription>
          Write it the way you would explain it to a new colleague. The bot answers only from what
          you put here.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-title`}>Heading</Label>
        <Input
          id={`${formId}-title`}
          placeholder="e.g. Refund policy"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-4">
        {sections.map((section, index) => (
          <fieldset key={index} className="flex flex-col gap-2 rounded-lg border p-3">
            <legend className="sr-only">Section {index + 1}</legend>
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor={`${formId}-sub-${index}`}>
                  {index === 0 ? "Subheading (optional)" : "Subheading"}
                </Label>
                <Input
                  id={`${formId}-sub-${index}`}
                  placeholder={
                    index === 0 ? "Leave empty for an introduction" : "e.g. Who qualifies"
                  }
                  value={section.subheading}
                  onChange={(event) => updateSection(index, { subheading: event.target.value })}
                />
              </div>
              {sections.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove section ${index + 1}`}
                  onClick={() => setSections((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </div>
            <Label htmlFor={`${formId}-body-${index}`} className="sr-only">
              Details for section {index + 1}
            </Label>
            <Textarea
              id={`${formId}-body-${index}`}
              rows={4}
              placeholder="The details the bot should know."
              value={section.body}
              onChange={(event) => updateSection(index, { body: event.target.value })}
            />
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => setSections((current) => [...current, { subheading: "", body: "" }])}
        >
          <Plus aria-hidden="true" />
          Add subheading
        </Button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-active`}>Use this training</Label>
          <p className="text-xs text-muted-foreground">
            Turn off to keep it without the bot using it.
          </p>
        </div>
        <Switch id={`${formId}-active`} checked={isActive} onCheckedChange={setIsActive} />
      </div>

      <p className={overLimit ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
        {content.length.toLocaleString("en")} / {TRAINING_CONTENT_MAX.toLocaleString("en")}{" "}
        characters
        {overLimit && ". Split it into two entries."}
      </p>
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
        <Button type="submit" disabled={pending || overLimit}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {entry ? "Save changes" : "Add training"}
        </Button>
      </DialogFooter>
    </form>
  );
}
