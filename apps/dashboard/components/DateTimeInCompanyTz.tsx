import { formatInCompanyTz } from "@soft-agent-support/shared";

type DateTimeInCompanyTzProps = {
  /** A UTC instant (Date or ISO string from a timestamptz column). */
  value: Date | string;
  /** IANA name from company_settings.timezone. */
  timeZone: string;
  className?: string;
};

/** Shows a timestamp in the company timezone, e.g. "Fri 9 Oct, 3:00 PM GMT+1". */
export function DateTimeInCompanyTz({ value, timeZone, className }: DateTimeInCompanyTzProps) {
  const iso = typeof value === "string" ? value : value.toISOString();
  return (
    <time dateTime={iso} className={className}>
      {formatInCompanyTz(value, timeZone)}
    </time>
  );
}
