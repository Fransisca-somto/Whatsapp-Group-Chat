// JID helpers. WhatsApp identifies people by phone JID (2348012345678@s.whatsapp.net) or by an
// anonymous LID (12345678@lid); either may carry a device suffix (":3") that must be ignored.
import { isLidUser, isPnUser, jidDecode, jidNormalizedUser } from "baileys";

import { E164_REGEX } from "@soft-agent-support/shared";

/** Strips the device suffix so IDs compare equal ("123:4@lid" → "123@lid"). */
export function sameUser(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return jidNormalizedUser(a) === jidNormalizedUser(b);
}

/** "2348012345678:3@s.whatsapp.net" → "+2348012345678"; null for LIDs and anything invalid. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid || !isPnUser(jid)) return null;
  const user = jidDecode(jid)?.user;
  const phone = user ? `+${user}` : null;
  return phone && E164_REGEX.test(phone) ? phone : null;
}

export type LidToPhoneLookup = (lid: string) => Promise<string | null>;

/**
 * Best-effort phone number for a sender (ADR-006: unknown → null → treated as unauthorized).
 * Order: the sender JID itself, its alternate JID, then Baileys' LID → phone mapping.
 */
export async function resolveSenderPhone(
  senderJid: string,
  altJid: string | null,
  lookup: LidToPhoneLookup,
): Promise<string | null> {
  const direct = phoneFromJid(senderJid) ?? phoneFromJid(altJid);
  if (direct) return direct;
  const lid = isLidUser(senderJid) ? senderJid : altJid && isLidUser(altJid) ? altJid : null;
  if (!lid) return null;
  try {
    return phoneFromJid(await lookup(jidNormalizedUser(lid)));
  } catch {
    return null;
  }
}
