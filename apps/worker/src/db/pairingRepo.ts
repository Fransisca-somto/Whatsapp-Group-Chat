// pairing_requests access (data-models.md §3.15, api-interfaces.md §2.1).
import type {
  PairingRequestKind,
  PairingRequestStatus,
  TablesUpdate,
} from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

export type PairingRequest = {
  id: string;
  kind: PairingRequestKind;
  phoneE164: string;
  status: PairingRequestStatus;
};

export type PairingStore = {
  /** Oldest request still waiting for the worker, if any. */
  nextRequested(): Promise<PairingRequest | null>;
  getStatus(id: string): Promise<PairingRequestStatus | null>;
  markCodeIssued(id: string, code: string, expiresAt: Date): Promise<void>;
  /** Moves a request to a final state, only if it is still open (never overrides a cancel). */
  finish(id: string, status: "paired" | "expired" | "failed", error?: string): Promise<void>;
  /** Expires requests left open by a previous worker run (crash or lost lock). */
  expireStale(): Promise<number>;
  /** Calls back on every new request (Realtime). Returns an unsubscribe function. */
  onInsert(callback: () => void): () => Promise<void>;
};

const OPEN_STATUSES = ["requested", "code_issued"] as const;

export function createPairingRepo(db: ServiceClient): PairingStore {
  async function update(id: string, patch: TablesUpdate<"pairing_requests">) {
    const { error } = await db
      .from("pairing_requests")
      .update(patch)
      .eq("id", id)
      .in("status", OPEN_STATUSES);
    if (error) throw new Error(`pairing_requests update failed: ${error.message}`);
  }

  return {
    async nextRequested() {
      const { data, error } = await db
        .from("pairing_requests")
        .select("id, kind, phone_e164, status")
        .eq("status", "requested")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`pairing_requests read failed: ${error.message}`);
      if (!data) return null;
      return {
        id: data.id,
        kind: data.kind as PairingRequestKind,
        phoneE164: data.phone_e164,
        status: data.status as PairingRequestStatus,
      };
    },

    async getStatus(id) {
      const { data, error } = await db
        .from("pairing_requests")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`pairing_requests read failed: ${error.message}`);
      return (data?.status as PairingRequestStatus | undefined) ?? null;
    },

    async markCodeIssued(id, code, expiresAt) {
      await update(id, {
        status: "code_issued",
        pairing_code: code,
        code_expires_at: expiresAt.toISOString(),
      });
    },

    async finish(id, status, error) {
      await update(id, { status, ...(error ? { error } : {}) });
    },

    async expireStale() {
      const { data, error } = await db
        .from("pairing_requests")
        .update({ status: "expired", error: "worker restarted before pairing finished" })
        .eq("status", "code_issued")
        .select("id");
      if (error) throw new Error(`pairing_requests expire failed: ${error.message}`);
      return data.length;
    },

    onInsert(callback) {
      const channel = db
        .channel("worker-pairing-requests")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "pairing_requests" },
          () => callback(),
        )
        .subscribe();
      return async () => {
        await db.removeChannel(channel);
      };
    },
  };
}
