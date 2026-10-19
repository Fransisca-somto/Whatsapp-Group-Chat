import { describe, expect, it, vi } from "vitest";

import { phoneFromJid, resolveSenderPhone, sameUser } from "./jids.ts";

describe("JID helpers", () => {
  it("compares users ignoring the device suffix", () => {
    expect(sameUser("2348012345678:3@s.whatsapp.net", "2348012345678@s.whatsapp.net")).toBe(true);
    expect(sameUser("99887766:12@lid", "99887766@lid")).toBe(true);
    expect(sameUser("99887766@lid", "2348012345678@s.whatsapp.net")).toBe(false);
    expect(sameUser(null, "99887766@lid")).toBe(false);
  });

  it("turns phone JIDs into E.164 and rejects LIDs", () => {
    expect(phoneFromJid("2348012345678:3@s.whatsapp.net")).toBe("+2348012345678");
    expect(phoneFromJid("99887766@lid")).toBeNull();
    expect(phoneFromJid(null)).toBeNull();
  });
});

describe("resolveSenderPhone", () => {
  const noLookup = vi.fn(() => Promise.resolve(null));

  it("uses the sender JID when it is a phone JID", async () => {
    await expect(resolveSenderPhone("2348012345678@s.whatsapp.net", null, noLookup)).resolves.toBe(
      "+2348012345678",
    );
  });

  it("uses the alternate JID when the sender is a LID", async () => {
    await expect(
      resolveSenderPhone("99887766@lid", "2348012345678@s.whatsapp.net", noLookup),
    ).resolves.toBe("+2348012345678");
  });

  it("falls back to the LID → phone mapping", async () => {
    const lookup = vi.fn(() => Promise.resolve("2348099999999:2@s.whatsapp.net"));
    await expect(resolveSenderPhone("99887766:5@lid", null, lookup)).resolves.toBe(
      "+2348099999999",
    );
    expect(lookup).toHaveBeenCalledWith("99887766@lid");
  });

  it("returns null when nothing resolves, or the lookup fails", async () => {
    await expect(resolveSenderPhone("99887766@lid", null, noLookup)).resolves.toBeNull();
    const failing = vi.fn(() => Promise.reject(new Error("store unavailable")));
    await expect(resolveSenderPhone("99887766@lid", null, failing)).resolves.toBeNull();
  });
});
