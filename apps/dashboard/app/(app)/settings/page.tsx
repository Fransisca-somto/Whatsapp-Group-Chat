import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/server/currentUser";
import { listOpenRouterModels } from "@/server/openrouter";

import { AiProviderForm } from "./AiProviderForm";
import { CompanySettingsForm } from "./CompanySettingsForm";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Company details and the AI provider the bot uses. Changes reach the bot within a minute."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <SettingsContent />
      </Suspense>
    </>
  );
}

async function SettingsContent() {
  const user = await requireCurrentUser();
  if (user.role !== "owner") redirect("/"); // owner only (ui-context.md §4)

  const supabase = await createClient();
  const [settingsResult, models] = await Promise.all([
    supabase
      .from("company_settings")
      .select(
        "company_name, bot_display_name, timezone, ai_chat_model, ai_fallback_model, openrouter_key_hint",
      )
      .eq("id", 1)
      .maybeSingle(),
    listOpenRouterModels(),
  ]);
  if (settingsResult.error) {
    throw new Error(`Could not load settings: ${settingsResult.error.message}`);
  }
  const settings = settingsResult.data;
  if (!settings) {
    return (
      <p className="rounded-xl border bg-surface p-6 text-sm text-muted-foreground">
        Company settings are missing. Run <span className="font-mono">supabase/seed.sql</span> once
        in the Supabase SQL Editor, then reload this page.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="company-title" className="rounded-xl border bg-surface p-6">
        <h2 id="company-title" className="mb-4 text-lg font-semibold">
          Company
        </h2>
        <CompanySettingsForm
          defaults={{
            companyName: settings.company_name,
            botDisplayName: settings.bot_display_name,
            timezone: settings.timezone,
          }}
          timeZones={Intl.supportedValuesOf("timeZone")}
        />
      </section>

      <section aria-labelledby="ai-title" className="rounded-xl border bg-surface p-6">
        <h2 id="ai-title" className="mb-1 text-lg font-semibold">
          AI provider
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          The bot uses your own OpenRouter account. Create a key at openrouter.ai → Keys, then pick
          the models below.
        </p>
        <AiProviderForm
          keyHint={settings.openrouter_key_hint}
          models={models}
          defaults={{
            chatModel: settings.ai_chat_model ?? "",
            fallbackModel: settings.ai_fallback_model,
          }}
        />
      </section>
    </div>
  );
}
