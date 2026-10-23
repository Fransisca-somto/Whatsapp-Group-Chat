"use client";

import { Input } from "@/components/ui/input";

type DateTimePickerProps = {
  id?: string;
  /** `YYYY-MM-DDTHH:mm`, a wall-clock time in the company timezone. */
  value: string;
  onChange: (value: string) => void;
  /** IANA name from company_settings.timezone, shown next to the input. */
  timeZone: string;
  invalid?: boolean;
  "aria-describedby"?: string;
};

/**
 * Date and time input interpreted in the company timezone (ui-context.md §5), never the
 * browser's. The value is a plain wall-clock string; the server converts it to UTC.
 */
export function DateTimePicker({
  id,
  value,
  onChange,
  timeZone,
  invalid,
  ...rest
}: DateTimePickerProps) {
  const labelId = id ? `${id}-tz` : undefined;
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <Input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={
          [rest["aria-describedby"], labelId].filter(Boolean).join(" ") || undefined
        }
        className="sm:max-w-60"
      />
      <span id={labelId} className="text-xs text-muted-foreground">
        {timeZone.replace(/_/g, " ")} time
      </span>
    </div>
  );
}
