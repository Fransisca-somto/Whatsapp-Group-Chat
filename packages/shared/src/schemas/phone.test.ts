import { describe, expect, it } from "vitest";

import { formatPhoneForDisplay, phoneE164Schema } from "./phone.ts";

describe("phoneE164Schema", () => {
  it("accepts E.164 and strips separators", () => {
    expect(phoneE164Schema.parse("+2348012345678")).toBe("+2348012345678");
    expect(phoneE164Schema.parse(" +234 801 234 5678 ")).toBe("+2348012345678");
    expect(phoneE164Schema.parse("+1 (415) 555-0100")).toBe("+14155550100");
  });

  it("rejects numbers without a country code or with bad digits", () => {
    expect(phoneE164Schema.safeParse("08012345678").success).toBe(false);
    expect(phoneE164Schema.safeParse("+0123456789").success).toBe(false);
    expect(phoneE164Schema.safeParse("+234801abc5678").success).toBe(false);
    expect(phoneE164Schema.safeParse("+1234567").success).toBe(false);
    expect(phoneE164Schema.safeParse("+1234567890123456").success).toBe(false);
  });
});

describe("formatPhoneForDisplay", () => {
  it("groups Nigerian numbers", () => {
    expect(formatPhoneForDisplay("+2348012345678")).toBe("+234 801 234 5678");
  });

  it("leaves other numbers unchanged", () => {
    expect(formatPhoneForDisplay("+14155550100")).toBe("+14155550100");
  });
});
