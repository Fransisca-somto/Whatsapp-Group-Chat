import { describe, expect, it } from "vitest";

import { pairingRequestInputSchema } from "./pairing.ts";

describe("pairingRequestInputSchema", () => {
  it("accepts pair and relink with a normalised phone", () => {
    expect(
      pairingRequestInputSchema.parse({ kind: "relink", phoneE164: "+234 801 234 5678" }),
    ).toEqual({ kind: "relink", phoneE164: "+2348012345678" });
  });

  it("rejects an unknown kind or a local-format phone", () => {
    expect(
      pairingRequestInputSchema.safeParse({ kind: "unlink", phoneE164: "+2348012345678" }).success,
    ).toBe(false);
    expect(
      pairingRequestInputSchema.safeParse({ kind: "pair", phoneE164: "08012345678" }).success,
    ).toBe(false);
  });
});
