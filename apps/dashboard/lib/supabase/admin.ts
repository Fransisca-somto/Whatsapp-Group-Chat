import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@soft-agent-support/shared";

import { getSupabaseEnv } from "./env";

/**
 * Service-role client, which bypasses RLS. Allowed only in (architecture.md §3):
 * - server/audit.ts: dashboard roles cannot write bot_actions (append-only audit, ADR-019);
 * - server/accounts.ts, server/actions/admin.ts, server/actions/team.ts: creating and deleting
 *   logins and tenants (ADR-039), always after their own platform-admin / owner check.
 * Never import this from other modules.
 */
export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY in apps/dashboard/.env.local (needed for the audit log and for adding people).",
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
