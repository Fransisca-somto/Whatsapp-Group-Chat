// worker_lock access (data-models.md §3.14, §5.4).
import type { ServiceClient } from "./supabase.ts";

export type LockStore = {
  /** Acquires or renews the lease. True when this instance holds it afterwards. */
  acquire(instanceId: string, leaseSeconds: number): Promise<boolean>;
  /** Clears the lease, but only if this instance still holds it. */
  release(instanceId: string): Promise<void>;
};

export function createLockRepo(db: ServiceClient): LockStore {
  return {
    async acquire(instanceId, leaseSeconds) {
      const { data, error } = await db.rpc("acquire_worker_lock", {
        p_instance: instanceId,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`acquire_worker_lock failed: ${error.message}`);
      return data;
    },

    async release(instanceId) {
      const { error } = await db
        .from("worker_lock")
        .update({ holder: null, lease_expires_at: new Date(0).toISOString() })
        .eq("id", 1)
        .eq("holder", instanceId);
      if (error) throw new Error(`worker_lock release failed: ${error.message}`);
    },
  };
}
