// Dashboard → worker pairing request (api-interfaces.md §2.1, §3 `requestPairing`).
import { z } from "zod";

import { pairingRequestKindSchema } from "./enums.ts";
import { phoneE164Schema } from "./phone.ts";

export const pairingRequestInputSchema = z.object({
  kind: pairingRequestKindSchema,
  phoneE164: phoneE164Schema,
});
export type PairingRequestInput = z.infer<typeof pairingRequestInputSchema>;

/** The word the owner must type to confirm a relink (ui-context.md §5, `<ConfirmDialog>`). */
export const RELINK_CONFIRMATION_WORD = "RELINK";

export const cancelPairingInputSchema = z.object({ requestId: z.uuid() });
export type CancelPairingInput = z.infer<typeof cancelPairingInputSchema>;
