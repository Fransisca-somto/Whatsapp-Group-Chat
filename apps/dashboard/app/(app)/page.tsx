import { LayoutDashboard, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/server/currentUser";

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" />
      <div className="flex flex-col gap-6">
        <Suspense fallback={null}>
          <AiSetupNotice />
        </Suspense>
        <EmptyState
          icon={LayoutDashboard}
          message="Worker health, groups and upcoming posts will appear here once the worker is connected."
        />
      </div>
    </>
  );
}

/** Shown until the owner has saved an OpenRouter key and a chat model (ADR-027). */
async function AiSetupNotice() {
  const user = await requireCurrentUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("openrouter_key_hint, ai_chat_model")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.error("AiSetupNotice: read failed", error);
    return null;
  }
  if (data?.openrouter_key_hint && data.ai_chat_model) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-status-warn/40 bg-surface p-4"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-status-warn" />
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">AI not configured</p>
        <p className="text-muted-foreground">
          The bot can&apos;t answer questions until an OpenRouter key and a chat model are saved.{" "}
          {user.role === "owner" ? (
            <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
              Open Settings
            </Link>
          ) : (
            "Ask the owner to set it up in Settings."
          )}
        </p>
      </div>
    </div>
  );
}
