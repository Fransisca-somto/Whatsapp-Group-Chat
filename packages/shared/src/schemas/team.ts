// Accounts (ADR-039): the platform admin creates owners (each with a new tenant), owners add
// staff to their own tenant, and anyone changes their own password. Logins start with a
// temporary password that the person replaces from the user menu.
import { z } from "zod";

import { isValidTimeZone } from "./companySettings.ts";

/** Supabase Auth accepts up to 72 characters (bcrypt). */
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Use at most 72 characters");

const personFields = {
  displayName: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  temporaryPassword: passwordSchema,
};

/** Admin → New owner: creates the login, the tenant, its settings and its connection row. */
export const createOwnerInputSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  timezone: z.string().trim().refine(isValidTimeZone, "Choose a valid time zone"),
  ...personFields,
});
export type CreateOwnerInput = z.infer<typeof createOwnerInputSchema>;

export const tenantStatusSchema = z.enum(["active", "suspended"]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const setTenantStatusInputSchema = z.object({
  tenantId: z.uuid(),
  status: tenantStatusSchema,
});

/** Team → Add staff: a staff login in the owner's own tenant. */
export const createStaffInputSchema = z.object(personFields);
export type CreateStaffInput = z.infer<typeof createStaffInputSchema>;

export const removeStaffInputSchema = z.object({ userId: z.uuid() });

/** User menu → Change password. */
export const changePasswordInputSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((input) => input.password === input.confirm, {
    message: "The passwords don't match",
    path: ["confirm"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
