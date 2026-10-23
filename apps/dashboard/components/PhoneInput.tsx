"use client";

import { formatPhoneForDisplay, phoneE164Schema } from "@soft-agent-support/shared";

import { Input } from "@/components/ui/input";

type PhoneInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
};

/**
 * Phone number in international format (ui-context.md §5). Spaces, dashes, dots and brackets are
 * fine; the saved form (E.164) is shown underneath once the number is valid.
 */
export function PhoneInput({ id, value, onChange, invalid }: PhoneInputProps) {
  const parsed = phoneE164Schema.safeParse(value);
  const hintId = id ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+234 801 234 5678"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={hintId}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {parsed.success
          ? `Saved as ${formatPhoneForDisplay(parsed.data)}`
          : "International format: + and the country code, e.g. +234 801 234 5678"}
      </p>
    </div>
  );
}
