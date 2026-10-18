import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import { decideAccess, type AccessDecision } from "./accessDecision";

export type CurrentUser = Extract<AccessDecision, { kind: "allowed" }>;

/** Looks up the signed-in user and their dashboard role. Deduplicated per request. */
export const getAccessDecision = cache(async (): Promise<AccessDecision> => {
  // With partial prefetching, cookies are available while prerendering, but getClaims() checks
  // token expiry with Date.now(), which prerendering forbids. Defer the check to request time.
  await connection();
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;
  if (!userId) {
    return decideAccess(null, null);
  }

  const { data: row, error } = await supabase
    .from("dashboard_users")
    .select("display_name, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not load dashboard role: ${error.message}`);
  }
  return decideAccess(userId, row);
});

/**
 * Returns the current dashboard user, or redirects: signed-out visitors to /login, users
 * without a dashboard role to the sign-out route (Server Components cannot clear cookies).
 */
export async function requireCurrentUser(): Promise<CurrentUser> {
  const decision = await getAccessDecision();
  if (decision.kind === "signed_out") {
    redirect("/login");
  }
  if (decision.kind === "no_access") {
    redirect("/auth/signout?reason=no_access");
  }
  return decision;
}
