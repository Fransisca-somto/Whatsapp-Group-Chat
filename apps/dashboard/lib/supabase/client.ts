import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@soft-agent-support/shared";

import { getSupabaseEnv } from "./env";

/** Supabase client for Client Components. Reads go through RLS as the signed-in user. */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
