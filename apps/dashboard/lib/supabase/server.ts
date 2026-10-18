import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { Database } from "@soft-agent-support/shared";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "./env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers, acting as the
 * signed-in user (RLS applies). Reading cookies makes the caller dynamic, so with Cache
 * Components it must run inside a <Suspense> boundary or a Server Action.
 */
export async function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. proxy.ts refreshes the session on every
          // request, so a token refreshed during render is persisted there instead.
        }
      },
    },
  });
}
