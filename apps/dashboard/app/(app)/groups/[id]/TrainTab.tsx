"use client";

import { BOT_INSTRUCTIONS_MAX } from "@soft-agent-support/shared";
import { Copy, GraduationCap, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  subheadingCount,
  trainingPreview,
  type TrainingEntryView,
  type TrainingSourceGroup,
} from "@/lib/training";
import {
  copyTraining,
  deleteTrainingEntry,
  setTrainingEntryActive,
  updateBotInstructions,
} from "@/server/actions/knowledge";

import { ImportTrainingDialog } from "./ImportTrainingDialog";
import { TrainingEntryDialog } from "./TrainingEntryDialog";

type Props = {
  groupId: string;
  groupName: string;
  entries: TrainingEntryView[];
  sourceGroups: TrainingSourceGroup[];
  botInstructions: string | null;
  timeZone: string;
};

/** The group's Train tab: what the bot knows in this group, and nowhere else (ADR-026). */
export function TrainTab({
  groupId,
  groupName,
  entries,
  sourceGroups,
  botInstructions,
  timeZone,
}: Props) {
  const [editing, setEditing] = useState<TrainingEntryView | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const activeCount = entries.filter((entry) => entry.is_active).length;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="training-title" className="rounded-xl border bg-surface p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 id="training-title" className="text-lg font-semibold">
              Training
            </h2>
            <p className="text-sm text-muted-foreground">
              {entries.length === 0
                ? "The bot only answers from what you add here."
                : `${activeCount} of ${entries.length} ${entries.length === 1 ? "entry" : "entries"} in use. Only this group's bot reads them.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" />
              Add training
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden="true" />
              Upload file
            </Button>
            {sourceGroups.length > 0 && (
              <Button variant="outline" onClick={() => setCopyOpen(true)}>
                <Copy aria-hidden="true" />
                Copy from group
              </Button>
            )}
          </div>
        </div>

        {entries.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            message="No training yet. Add what the bot should know in this group, or upload a .txt or .md file. Until then it replies that it hasn't been set up here."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {entries.map((entry) => (
              <TrainingRow
                key={entry.id}
                groupId={groupId}
                entry={entry}
                timeZone={timeZone}
                onEdit={() => setEditing(entry)}
              />
            ))}
          </ul>
        )}
      </section>

      <BotInstructionsForm groupId={groupId} defaultValue={botInstructions} />

      <TrainingEntryDialog
        groupId={groupId}
        entry={editing === "new" || editing === null ? undefined : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <ImportTrainingDialog groupId={groupId} open={importOpen} onOpenChange={setImportOpen} />
      <CopyTrainingDialog
        groupId={groupId}
        groupName={groupName}
        sourceGroups={sourceGroups}
        open={copyOpen}
        onOpenChange={setCopyOpen}
      />
    </div>
  );
}

function TrainingRow({
  groupId,
  entry,
  timeZone,
  onEdit,
}: {
  groupId: string;
  entry: TrainingEntryView;
  timeZone: string;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const subheadings = subheadingCount(entry.content);

  const setActive = (isActive: boolean) =>
    startTransition(async () => {
      const result = await setTrainingEntryActive({ id: entry.id, groupId, isActive });
      if (result.ok) {
        toast.success(
          isActive ? "The bot uses this training again." : "The bot stops using this training.",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteTrainingEntry({ id: entry.id, groupId });
      if (result.ok) {
        toast.success("Training deleted.");
        setDeleteOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{entry.title}</h3>
          {!entry.is_active && <Badge variant="outline">Not in use</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{trainingPreview(entry.content)}</p>
        <p className="text-xs text-muted-foreground">
          {subheadings > 0 &&
            `${subheadings} ${subheadings === 1 ? "subheading" : "subheadings"} · `}
          Edited <DateTimeInCompanyTz value={entry.updated_at} timeZone={timeZone} />
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          aria-label={`Use “${entry.title}”`}
          checked={entry.is_active}
          disabled={pending}
          onCheckedChange={setActive}
        />
        <Button variant="ghost" size="icon" aria-label={`Edit “${entry.title}”`} onClick={onEdit}>
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete “${entry.title}”`}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${entry.title}”?`}
        description="The bot stops using it straight away. To keep it without the bot using it, turn it off instead."
        confirmLabel="Delete"
        destructive
        pending={pending}
        onConfirm={remove}
      />
    </li>
  );
}

function CopyTrainingDialog({
  groupId,
  groupName,
  sourceGroups,
  open,
  onOpenChange,
}: {
  groupId: string;
  groupName: string;
  sourceGroups: TrainingSourceGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const selectId = useId();
  const [fromGroupId, setFromGroupId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const source = sourceGroups.find((group) => group.id === fromGroupId);
  const labels = Object.fromEntries(
    sourceGroups.map((group) => [
      group.id,
      `${group.name} (${group.entryCount} ${group.entryCount === 1 ? "entry" : "entries"})`,
    ]),
  );

  const copy = () => {
    if (!fromGroupId) return;
    startTransition(async () => {
      const result = await copyTraining({ fromGroupId, toGroupId: groupId });
      if (result.ok) {
        toast.success(
          `${result.data.count} ${result.data.count === 1 ? "entry" : "entries"} copied.`,
        );
        setFromGroupId(null);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFromGroupId(null);
        onOpenChange(next);
      }}
      title="Copy training from another group"
      description={`Every entry from the group you pick is added to “${groupName}”. The copies are separate: editing one group's training never changes the other's.`}
      confirmLabel={
        source
          ? `Copy ${source.entryCount} ${source.entryCount === 1 ? "entry" : "entries"}`
          : "Copy"
      }
      canConfirm={fromGroupId !== null}
      pending={pending}
      onConfirm={copy}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={selectId}>Copy from</Label>
        <Select items={labels} value={fromGroupId} onValueChange={(value) => setFromGroupId(value)}>
          <SelectTrigger id={selectId} placeholder="Pick a group" />
          <SelectContent>
            {sourceGroups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {labels[group.id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ConfirmDialog>
  );
}

function BotInstructionsForm({
  groupId,
  defaultValue,
}: {
  groupId: string;
  defaultValue: string | null;
}) {
  const router = useRouter();
  const textareaId = useId();
  const [saved, setSaved] = useState(defaultValue ?? "");
  const [value, setValue] = useState(defaultValue ?? "");
  const [pending, startTransition] = useTransition();
  const tooLong = value.trim().length > BOT_INSTRUCTIONS_MAX;

  const save = () =>
    startTransition(async () => {
      const result = await updateBotInstructions({ groupId, instructions: value });
      if (result.ok) {
        toast.success(value.trim() ? "Instructions saved." : "Instructions cleared.");
        setSaved(value);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <section aria-labelledby="instructions-title" className="rounded-xl border bg-surface p-6">
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="flex flex-col gap-1">
          <h2 id="instructions-title" className="text-lg font-semibold">
            Bot instructions (optional)
          </h2>
          <p className="text-sm text-muted-foreground">
            Extra guidance for how the bot behaves in this group, e.g. &ldquo;This is the sales
            team. Mention the sales manager for discounts.&rdquo; The bot&apos;s core rules always
            apply.
          </p>
        </div>
        <Label htmlFor={textareaId} className="sr-only">
          Bot instructions
        </Label>
        <Textarea
          id={textareaId}
          rows={3}
          value={value}
          aria-invalid={tooLong ? true : undefined}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className={tooLong ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
          {value.trim().length.toLocaleString("en")} / {BOT_INSTRUCTIONS_MAX.toLocaleString("en")}{" "}
          characters
        </p>
        <Button type="submit" className="w-fit" disabled={pending || tooLong || value === saved}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          Save instructions
        </Button>
      </form>
    </section>
  );
}
