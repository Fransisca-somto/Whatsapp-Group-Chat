import { randomBytes } from "node:crypto";

import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthStateRow, AuthStateStore } from "../db/authStateRepo.ts";
import { createSupabaseAuthState } from "./authState.ts";
import { decryptValue } from "./crypto.ts";

const logger = pino({ level: "silent" });
const encryptionKey = randomBytes(32);

function memoryStore() {
  const rows = new Map<string, string>();
  const upsertMany = vi.fn((batch: AuthStateRow[]) => {
    for (const row of batch) rows.set(row.key, row.value_enc);
    return Promise.resolve();
  });
  const deleteMany = vi.fn((keys: string[]) => {
    for (const key of keys) rows.delete(key);
    return Promise.resolve();
  });
  const store: AuthStateStore = {
    loadAll: () => Promise.resolve([...rows].map(([key, value_enc]) => ({ key, value_enc }))),
    upsertMany,
    deleteMany,
    deleteAll: () => {
      rows.clear();
      return Promise.resolve();
    },
  };
  return { rows, store, upsertMany, deleteMany };
}

function setup(canWrite = () => true) {
  const mem = memoryStore();
  const auth = createSupabaseAuthState({ store: mem.store, encryptionKey, logger, canWrite });
  return { ...mem, auth };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Supabase auth state", () => {
  it("starts unregistered with fresh creds when nothing is stored", async () => {
    const { auth } = setup();
    await auth.load();
    expect(auth.isRegistered()).toBe(false);
    expect(auth.getState().creds.noiseKey.public).toBeInstanceOf(Uint8Array);
  });

  it("writes creds immediately, encrypted, and restores them (Buffers included)", async () => {
    const first = setup();
    await first.auth.load();
    const creds = first.auth.getState().creds;
    creds.registered = true;
    await first.auth.saveCreds();

    const stored = first.rows.get("creds");
    expect(stored).toBeDefined();
    expect(stored).not.toContain("registered"); // ciphertext, not JSON
    expect(JSON.parse(decryptValue(stored ?? "", "creds", encryptionKey))).toMatchObject({
      registered: true,
    });

    const second = createSupabaseAuthState({
      store: first.store,
      encryptionKey,
      logger,
      canWrite: () => true,
    });
    await second.load();
    expect(second.isRegistered()).toBe(true);
    expect(Buffer.from(second.getState().creds.noiseKey.private)).toEqual(
      Buffer.from(creds.noiseKey.private),
    );
  });

  it("debounces key writes into one batch", async () => {
    const { auth, upsertMany } = setup();
    await auth.load();
    const { keys } = auth.getState();

    await keys.set({ session: { a: new Uint8Array([1]) } });
    await vi.advanceTimersByTimeAsync(300);
    await keys.set({ session: { b: new Uint8Array([2]) } });
    await vi.advanceTimersByTimeAsync(300);
    expect(upsertMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(upsertMany).toHaveBeenCalledOnce();
    expect(upsertMany.mock.calls[0]?.[0].map((r) => r.key).sort()).toEqual([
      "session-a",
      "session-b",
    ]);
  });

  it("serves reads from the cache before anything is written", async () => {
    const { auth } = setup();
    await auth.load();
    const { keys } = auth.getState();
    await keys.set({ session: { a: new Uint8Array([7, 8]) } });
    const got = await keys.get("session", ["a", "missing"]);
    expect(Buffer.from(got.a ?? [])).toEqual(Buffer.from([7, 8]));
    expect(got).not.toHaveProperty("missing");
  });

  it("deletes keys set to null", async () => {
    const { auth, rows, deleteMany } = setup();
    await auth.load();
    const { keys } = auth.getState();
    await keys.set({
      "pre-key": { "1": { public: new Uint8Array(1), private: new Uint8Array(1) } },
    });
    await auth.flush();
    expect(rows.has("pre-key-1")).toBe(true);

    await keys.set({ "pre-key": { "1": null } });
    await auth.flush();
    expect(deleteMany).toHaveBeenCalledWith(["pre-key-1"]);
    expect(rows.has("pre-key-1")).toBe(false);
    expect(await keys.get("pre-key", ["1"])).toEqual({});
  });

  it("does not write when the lock is not held", async () => {
    let held = true;
    const { auth, upsertMany } = setup(() => held);
    await auth.load();
    held = false;
    await auth.getState().keys.set({ session: { a: new Uint8Array([1]) } });
    await auth.flush();
    expect(upsertMany).not.toHaveBeenCalled();
  });

  it("drops pending writes on discardPending", async () => {
    const { auth, upsertMany } = setup();
    await auth.load();
    await auth.getState().keys.set({ session: { a: new Uint8Array([1]) } });
    auth.discardPending();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(upsertMany).not.toHaveBeenCalled();
  });

  it("retries a failed write", async () => {
    const { auth, upsertMany, rows } = setup();
    await auth.load();
    upsertMany.mockRejectedValueOnce(new Error("network down"));
    await auth.getState().keys.set({ session: { a: new Uint8Array([1]) } });
    await vi.advanceTimersByTimeAsync(500); // first attempt fails
    expect(rows.has("session-a")).toBe(false);
    await vi.advanceTimersByTimeAsync(500); // retry succeeds
    expect(rows.has("session-a")).toBe(true);
  });

  it("clear() leaves storage alone when the lock is not held", async () => {
    let held = true;
    const { auth, rows } = setup(() => held);
    await auth.load();
    await auth.saveCreds();
    held = false;
    await auth.clear();
    expect(rows.has("creds")).toBe(true);
    expect(auth.isRegistered()).toBe(false);
  });

  it("clear() wipes storage and resets to fresh creds", async () => {
    const { auth, rows } = setup();
    await auth.load();
    auth.getState().creds.registered = true;
    await auth.saveCreds();
    const oldNoise = Buffer.from(auth.getState().creds.noiseKey.public);

    await auth.clear();
    expect(rows.size).toBe(0);
    expect(auth.isRegistered()).toBe(false);
    expect(Buffer.from(auth.getState().creds.noiseKey.public)).not.toEqual(oldNoise);
  });
});
