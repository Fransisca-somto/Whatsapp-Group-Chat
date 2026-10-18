// E.164 phone numbers (data-models.md §3.5 check constraint, ui-context.md §6 display format).
import { z } from "zod";

export const E164_REGEX = /^\+[1-9][0-9]{7,14}$/;

/** Accepts common separators (spaces, dashes, dots, parentheses) and normalises to E.164. */
export const phoneE164Schema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s\-().]/g, ""))
  .pipe(
    z
      .string()
      .regex(
        E164_REGEX,
        "Enter the number in international format, starting with + and the country code",
      ),
  );

/**
 * Adds spaces for readability. Nigerian numbers (+234) are grouped as "+234 801 234 5678";
 * other countries are returned unchanged, since grouping rules vary by country.
 */
export function formatPhoneForDisplay(phoneE164: string): string {
  const nigeria = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(phoneE164);
  if (nigeria) {
    return `+234 ${nigeria[1]} ${nigeria[2]} ${nigeria[3]}`;
  }
  return phoneE164;
}
