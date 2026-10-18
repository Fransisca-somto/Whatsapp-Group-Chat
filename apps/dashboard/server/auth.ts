"use server";

import { loginSchema } from "@soft-agent-support/shared";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { decideAccess } from "./accessDecision";

export type LoginResult = { error: string };

export async function login(input: unknown): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return { error: "Email or password is incorrect." };
  }

  const { data: row, error: roleError } = await supabase
    .from("dashboard_users")
    .select("display_name, role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (roleError) {
    console.error("login: could not load dashboard role", roleError);
    await supabase.auth.signOut();
    return { error: "Could not check your access. Please try again." };
  }
  if (decideAccess(data.user.id, row).kind !== "allowed") {
    await supabase.auth.signOut();
    return { error: "This account does not have dashboard access. Ask the owner to add you." };
  }

  redirect("/");
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("logout: sign-out failed", error);
  }
  redirect("/login");
}
