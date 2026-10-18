// AES-256-GCM for wa_auth_state values (architecture.md §6). Stored format:
// base64(iv[12] ‖ ciphertext ‖ tag[16]). The row key is bound as associated data, so a value
// copied onto another row fails to decrypt instead of being silently accepted.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptValue(plaintext: string, rowKey: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(rowKey, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64");
}

/** Throws if the value was tampered with, belongs to another row, or used another key. */
export function decryptValue(payload: string, rowKey: string, key: Buffer): string {
  const data = Buffer.from(payload, "base64");
  if (data.length < IV_BYTES + TAG_BYTES) {
    throw new Error("encrypted value is too short");
  }
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES, data.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(rowKey, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
