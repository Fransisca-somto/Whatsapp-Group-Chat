import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/server/currentUser";

import { ConnectionPanel } from "./ConnectionPanel";

export default function ConnectionPage() {
  return (
    <>
      <PageHeader
        title="Connection"
        description="Link the bot's WhatsApp number and watch the worker's health."
      />
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <ConnectionContent />
      </Suspense>
    </>
  );
}

async function ConnectionContent() {
  const user = await requireCurrentUser();
  if (user.role !== "owner") redirect("/"); // owner only (ui-context.md §4)

  const supabase = await createClient();
  const [connection, request, settings] = await Promise.all([
    supabase
      .from("wa_connection")
      .select("status, linked_phone_e164, last_heartbeat_at, last_connected_at, last_error")
      .eq("id", 1)
      .maybeSingle(),
    supabase
      .from("pairing_requests")
      .select("id, kind, status, pairing_code, code_expires_at, error, phone_e164, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("company_settings").select("timezone").eq("id", 1).maybeSingle(),
  ]);
  for (const result of [connection, request, settings]) {
    if (result.error) throw new Error(`Could not load connection details: ${result.error.message}`);
  }

  return (
    <ConnectionPanel
      initialConnection={connection.data}
      initialRequest={request.data}
      timeZone={settings.data?.timezone ?? "UTC"}
    />
  );
}
