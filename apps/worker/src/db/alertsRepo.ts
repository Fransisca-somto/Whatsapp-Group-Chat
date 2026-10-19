// alerts access (data-models.md §3.16) plus the email settings the database job needs.
import type { AlertKind } from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

export type AlertStore = {
  /** True when an alert of this kind is still unresolved (the incident is ongoing). */
  hasOpen(kind: AlertKind): Promise<boolean>;
  /** Records a new incident. False if this exact incident key already exists. */
  open(kind: AlertKind, incidentKey: string): Promise<boolean>;
  markSent(incidentKey: string): Promise<void>;
  resolve(kinds: AlertKind[]): Promise<number>;
  companyTimezone(): Promise<string>;
  /** Copies email settings into Vault for the database's offline check (migration 0008). */
  configureDatabaseEmail(apiKey: string, recipients: string[], from: string): Promise<void>;
};

const UNIQUE_VIOLATION = "23505";

export function createAlertsRepo(db: ServiceClient): AlertStore {
  return {
    async hasOpen(kind) {
      const { count, error } = await db
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("kind", kind)
        .is("resolved_at", null);
      if (error) throw new Error(`alerts read failed: ${error.message}`);
      return (count ?? 0) > 0;
    },

    async open(kind, incidentKey) {
      const { error } = await db.from("alerts").insert({ kind, incident_key: incidentKey });
      if (error?.code === UNIQUE_VIOLATION) return false;
      if (error) throw new Error(`alerts insert failed: ${error.message}`);
      return true;
    },

    async markSent(incidentKey) {
      const { error } = await db
        .from("alerts")
        .update({ sent_at: new Date().toISOString() })
        .eq("incident_key", incidentKey);
      if (error) throw new Error(`alerts update failed: ${error.message}`);
    },

    async resolve(kinds) {
      const { data, error } = await db
        .from("alerts")
        .update({ resolved_at: new Date().toISOString() })
        .in("kind", kinds)
        .is("resolved_at", null)
        .select("id");
      if (error) throw new Error(`alerts resolve failed: ${error.message}`);
      return data.length;
    },

    async companyTimezone() {
      const { data, error } = await db
        .from("company_settings")
        .select("timezone")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw new Error(`company_settings read failed: ${error.message}`);
      return data?.timezone ?? "UTC";
    },

    async configureDatabaseEmail(apiKey, recipients, from) {
      const { error } = await db.rpc("configure_alert_email", {
        p_api_key: apiKey,
        p_recipients: recipients,
        p_from: from,
      });
      if (error) throw new Error(`configure_alert_email failed: ${error.message}`);
    },
  };
}
