// Service-role Supabase client (architecture.md §3 rule 3). Only modules under db/ import this.
import type { Database } from "@soft-agent-support/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ServiceClient = SupabaseClient<Database>;

export function createServiceClient(url: string, serviceRoleKey: string): ServiceClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
