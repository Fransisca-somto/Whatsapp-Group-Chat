"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { companySettingsSchema, type CompanySettings } from "@soft-agent-support/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateCompanySettings } from "@/server/actions/settings";

/** Company name, bot name and timezone (ui-context.md §4 `/settings`). */
export function CompanySettingsForm({
  defaults,
  timeZones,
}: {
  defaults: CompanySettings;
  timeZones: readonly string[];
}) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CompanySettings>({
    resolver: zodResolver(companySettingsSchema),
    defaultValues: defaults,
  });

  const onSubmit = async (values: CompanySettings) => {
    const result = await updateCompanySettings(values);
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
        <Label htmlFor="company-name">Company name</Label>
        <Input
          id="company-name"
          autoComplete="organization"
          aria-invalid={errors.companyName ? true : undefined}
          {...register("companyName")}
        />
        <p className="text-xs text-muted-foreground">
          The bot introduces itself as working for this company.
        </p>
        {errors.companyName && (
          <p className="text-sm text-destructive">{errors.companyName.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bot-name">Bot name</Label>
        <Input
          id="bot-name"
          autoComplete="off"
          aria-invalid={errors.botDisplayName ? true : undefined}
          {...register("botDisplayName")}
        />
        {errors.botDisplayName && (
          <p className="text-sm text-destructive">{errors.botDisplayName.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone">Time zone</Label>
        <Input
          id="timezone"
          list="timezone-options"
          autoComplete="off"
          placeholder="e.g. Africa/Lagos"
          aria-invalid={errors.timezone ? true : undefined}
          {...register("timezone")}
        />
        <datalist id="timezone-options">
          {timeZones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          Used for every date and time the bot reads or shows. Start typing a city to search.
        </p>
        {errors.timezone && <p className="text-sm text-destructive">{errors.timezone.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting || !isDirty} className="w-fit">
        {isSubmitting && <Loader2 aria-hidden="true" className="animate-spin" />}
        Save company settings
      </Button>
    </form>
  );
}
