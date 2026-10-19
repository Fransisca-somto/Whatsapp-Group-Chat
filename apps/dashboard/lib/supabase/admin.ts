import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@soft-agent-support/shared";

import { getSupabaseEnv } from "./env";

/**
 * Service-role client, which bypasses RLS. Used only by server/audit.ts: dashboard roles cannot
 * write bot_actions (append-only audit, ADR-019). Never import this from other modules.
 */
export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY in apps/dashboard/.env.local (needed to write the audit log).",
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
