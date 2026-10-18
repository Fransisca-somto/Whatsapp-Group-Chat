import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptValue, encryptValue } from "./crypto.ts";

const key = randomBytes(32);

describe("auth-state encryption", () => {
  it("round-trips a value", () => {
    const payload = encryptValue('{"hello":"world"}', "creds", key);
    expect(decryptValue(payload, "creds", key)).toBe('{"hello":"world"}');
  });

  it("uses a fresh IV each time", () => {
    expect(encryptValue("same", "creds", key)).not.toBe(encryptValue("same", "creds", key));
  });

  it("rejects a tampered value", () => {
    const data = Buffer.from(encryptValue("secret", "creds", key), "base64");
    data[14] = (data[14] ?? 0) ^ 0xff;
    expect(() => decryptValue(data.toString("base64"), "creds", key)).toThrow();
  });

  it("rejects a value moved to another row", () => {
    const payload = encryptValue("secret", "session-a", key);
    expect(() => decryptValue(payload, "session-b", key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const payload = encryptValue("secret", "creds", key);
    expect(() => decryptValue(payload, "creds", randomBytes(32))).toThrow();
  });
});
