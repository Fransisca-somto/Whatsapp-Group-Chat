"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { groupSettingsSchema, type GroupSettings } from "@soft-agent-support/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { REMINDER_PERMISSION_LABELS } from "@/lib/groups";
import { updateGroupSettings } from "@/server/actions/groups";

/** Per-group settings (ui-context.md §4 `/groups/[id]`). */
export function GroupSettingsForm({
  groupId,
  defaults,
}: {
  groupId: string;
  defaults: GroupSettings;
}) {
  const router = useRouter();
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<GroupSettings>({
    resolver: zodResolver(groupSettingsSchema),
    defaultValues: defaults,
  });

  const onSubmit = async (values: GroupSettings) => {
    const result = await updateGroupSettings({ groupId, ...values });
    if (result.ok) {
      toast.success("Settings saved.");
      reset(values);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-5 sm:max-w-lg">
      <div className="flex flex-col gap-2">
        <Label htmlFor="reminder-permission">Who can create reminders by tagging the bot</Label>
        <Controller
          control={control}
          name="reminderPermission"
          render={({ field }) => (
            <Select
              items={REMINDER_PERMISSION_LABELS}
              value={field.value}
              onValueChange={(value) => field.onChange(value)}
            >
              <SelectTrigger id="reminder-permission" />
              <SelectContent>
                {Object.entries(REMINDER_PERMISSION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-xs text-muted-foreground">
          “Authorized users only” uses the Authorized users list.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ai-enabled">Answer questions when tagged</Label>
          <p className="text-xs text-muted-foreground">
            Turn off to keep the bot silent in this group.
          </p>
        </div>
        <Controller
          control={control}
          name="aiEnabled"
          render={({ field }) => (
            <Switch id="ai-enabled" checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="general-knowledge">Answer general questions too</Label>
          <p className="text-xs text-muted-foreground">
            Lets the bot answer everyday questions from its own knowledge, like “What is WhatsApp
            used for?”. Questions about your company are still answered only from this group&apos;s
            training. Turn off to answer from the training only.
          </p>
        </div>
        <Controller
          control={control}
          name="allowGeneralKnowledge"
          render={({ field }) => (
            <Switch id="general-knowledge" checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="daily-cap">Daily reply limit</Label>
        <Input
          id="daily-cap"
          type="number"
          min={1}
          inputMode="numeric"
          className="w-32"
          aria-invalid={errors.dailyReplyCap ? true : undefined}
          {...register("dailyReplyCap", { valueAsNumber: true })}
        />
        {errors.dailyReplyCap && (
          <p className="text-sm text-destructive">{errors.dailyReplyCap.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="retention">Keep messages for (days)</Label>
        <Input
          id="retention"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="Forever"
          className="w-32"
          aria-invalid={errors.retentionDays ? true : undefined}
          {...register("retentionDays", {
            // "Keep forever" is null; RHF can pass that null back in, and Number(null) would be 0.
            setValueAs: (value: string | null) =>
              value === "" || value === null ? null : Number(value),
          })}
        />
        <p className="text-xs text-muted-foreground">Leave empty to keep messages forever.</p>
        {errors.retentionDays && (
          <p className="text-sm text-destructive">{errors.retentionDays.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting || !isDirty} className="w-fit">
        {isSubmitting && <Loader2 aria-hidden="true" className="animate-spin" />}
        Save settings
      </Button>
    </form>
  );
}
