import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Clears the session and returns to /login. Used when a signed-in user has no dashboard role,
// because Server Components cannot clear cookies themselves.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("signout route: sign-out failed", error);
  }

  const loginUrl = new URL("/login", request.url);
  if (request.nextUrl.searchParams.get("reason") === "no_access") {
    loginUrl.searchParams.set("error", "no_access");
  }
  return NextResponse.redirect(loginUrl);
}
