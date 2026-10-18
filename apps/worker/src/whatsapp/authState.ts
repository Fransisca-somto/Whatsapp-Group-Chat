// Baileys auth state stored in Supabase (architecture.md §6).
//
// - Reads come from an in-memory cache loaded once at startup (load()).
// - Signal key writes are debounced (500 ms) and batched into one upsert plus one delete.
// - creds are written immediately (saveCreds()).
// - Writes only happen while canWrite() is true (this instance holds the leader lock). A fenced
//   worker drops its pending writes so it can never overwrite the new holder's session.
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "baileys";

import type { AuthStateStore } from "../db/authStateRepo.ts";
import type { Logger } from "../logger.ts";
import { decryptValue, encryptValue } from "./crypto.ts";

const CREDS_KEY = "creds";

export type AuthStateOptions = {
  store: AuthStateStore;
  encryptionKey: Buffer;
  logger: Logger;
  canWrite: () => boolean;
  debounceMs?: number;
};

export type SupabaseAuthState = {
  /** Loads every row into memory. Call once before creating a socket. */
  load(): Promise<void>;
  /** The state to pass to makeWASocket. A new object after clear(). */
  getState(): AuthenticationState;
  /** True once the number has been linked (pairing completed). */
  isRegistered(): boolean;
  /** Persists the current creds now (wire to the `creds.update` event). */
  saveCreds(): Promise<void>;
  /** Writes any pending key changes now. */
  flush(): Promise<void>;
  /** Forgets pending writes without sending them (used when the lock is lost). */
  discardPending(): void;
  /** Deletes the stored session (logout / relink) and starts from fresh creds. */
  clear(): Promise<void>;
};

const serialize = (value: unknown) => JSON.stringify(value, BufferJSON.replacer);
const deserialize = (json: string): unknown => JSON.parse(json, BufferJSON.reviver);

export function createSupabaseAuthState(options: AuthStateOptions): SupabaseAuthState {
  const { store, encryptionKey, canWrite, debounceMs = 500 } = options;
  const log = options.logger.child({ module: "authState" });

  /** Serialized JSON per row key (fresh objects are parsed on every read). */
  const cache = new Map<string, string>();
  /** Row key → serialized value to upsert, or null to delete. */
  let pending = new Map<string, string | null>();
  let timer: NodeJS.Timeout | undefined;
  let writing: Promise<void> = Promise.resolve();
  let state = makeState(initAuthCreds());

  function makeState(creds: AuthenticationCreds): AuthenticationState {
    return {
      creds,
      keys: {
        get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            const json = cache.get(`${type}-${id}`);
            if (json === undefined) continue;
            let value = deserialize(json);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value as SignalDataTypeMap[T];
          }
          return result;
        },
        set: (data: SignalDataSet) => {
          for (const [type, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries ?? {})) {
              const rowKey = `${type}-${id}`;
              if (value === null || value === undefined) {
                cache.delete(rowKey);
                pending.set(rowKey, null);
              } else {
                const json = serialize(value);
                cache.set(rowKey, json);
                pending.set(rowKey, json);
              }
            }
          }
          schedule();
        },
      },
    };
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch((error: unknown) => {
        log.error({ err: error }, "auth state flush failed; will retry");
        schedule();
      });
    }, debounceMs);
  }

  async function writeBatch(batch: Map<string, string | null>): Promise<void> {
    if (batch.size === 0) return;
    if (!canWrite()) {
      log.warn({ dropped: batch.size }, "auth state write skipped: lock not held");
      return;
    }
    const upserts: { key: string; value_enc: string }[] = [];
    const deletes: string[] = [];
    for (const [key, json] of batch) {
      if (json === null) deletes.push(key);
      else upserts.push({ key, value_enc: encryptValue(json, key, encryptionKey) });
    }
    try {
      if (upserts.length) await store.upsertMany(upserts);
      if (deletes.length) await store.deleteMany(deletes);
      log.debug({ upserts: upserts.length, deletes: deletes.length }, "auth state written");
    } catch (error) {
      // Put the batch back unless a newer change for the same key arrived meanwhile.
      for (const [key, json] of batch) {
        if (!pending.has(key)) pending.set(key, json);
      }
      throw error;
    }
  }

  /** Runs writes one at a time so batches land in order. */
  function enqueueWrite(): Promise<void> {
    const run = writing.then(() => {
      const batch = pending;
      pending = new Map();
      return writeBatch(batch);
    });
    writing = run.catch(() => {});
    return run;
  }

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = undefined;
    await enqueueWrite();
  }

  return {
    async load() {
      const rows = await store.loadAll();
      cache.clear();
      for (const row of rows) {
        cache.set(row.key, decryptValue(row.value_enc, row.key, encryptionKey));
      }
      const credsJson = cache.get(CREDS_KEY);
      state = makeState(
        credsJson ? (deserialize(credsJson) as AuthenticationCreds) : initAuthCreds(),
      );
      log.info({ rows: rows.length, registered: state.creds.registered }, "auth state loaded");
    },

    getState: () => state,

    isRegistered: () => state.creds.registered,

    async saveCreds() {
      const json = serialize(state.creds);
      cache.set(CREDS_KEY, json);
      pending.set(CREDS_KEY, json);
      await flush();
    },

    flush,

    discardPending() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (pending.size) log.warn({ dropped: pending.size }, "auth state pending writes discarded");
      pending = new Map();
    },

    async clear() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = new Map();
      await writing;
      if (canWrite()) {
        await store.deleteAll();
      } else {
        log.warn("auth state clear skipped in storage: lock not held");
      }
      cache.clear();
      state = makeState(initAuthCreds());
      log.info("auth state cleared");
    },
  };
}
