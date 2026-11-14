// A random temporary password for a new login (ADR-039). Letters and digits only, without the
// look-alikes 0/O and 1/l/I, so it can be read out or typed from a message without mistakes.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function suggestTemporaryPassword(length = 14): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join("");
}
