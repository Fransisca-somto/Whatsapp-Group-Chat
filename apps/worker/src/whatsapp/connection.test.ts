import { DisconnectReason, type ConnectionState } from "baileys";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionPatch } from "../db/connectionRepo.ts";
import type { SupabaseAuthState } from "./authState.ts";
import { AlreadyLinkedError, createConnectionManager, type SocketLike } from "./connection.ts";

const logger = pino({ level: "silent" });

type Listener = (payload: unknown) => void;

function fakeSocket() {
  const listeners = new Map<string, Listener[]>();
  const sock = {
    ev: {
      on: (event: string, listener: Listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    requestPairingCode: vi.fn(() => Promise.resolve("ABCD1234")),
    logout: vi.fn(() => Promise.resolve()),
    end: vi.fn(() => Promise.resolve()),
    user: { id: "2348012345678:3@s.whatsapp.net", lid: "99887766:3@lid" },
  };
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const update = (u: Partial<ConnectionState>) => emit("connection.update", u);
  const close = (statusCode?: number) =>
    update({
      connection: "close",
      lastDisconnect: {
        error: Object.assign(new Error("closed"), { output: { statusCode } }),
        date: new Date(),
      },
    });
  return { sock, emit, update, close };
}

function setup(registered: boolean, canConnect: () => boolean = () => true) {
  const state = { registered };
  const clear = vi.fn(() => Promise.resolve());
  const authFlush = vi.fn(() => Promise.resolve());
  const auth = {
    load: vi.fn(),
    getState: vi.fn(() => ({ creds: {}, keys: {} })),
    isRegistered: () => state.registered,
    saveCreds: vi.fn(() => Promise.resolve()),
    flush: authFlush,
    discardPending: vi.fn(),
    clear,
  } as unknown as SupabaseAuthState;

  const sockets: ReturnType<typeof fakeSocket>[] = [];
  const statuses: ConnectionPatch[] = [];
  const onAlert = vi.fn();
  const manager = createConnectionManager({
    auth,
    store: {
      update: (patch) => {
        statuses.push(patch);
        return Promise.resolve();
      },
    },
    logger,
    instanceId: "test",
    onAlert,
    canConnect,
    random: () => 0.5,
    createSocket: () => {
      const fake = fakeSocket();
      sockets.push(fake);
      return Promise.resolve(fake.sock as unknown as SocketLike);
    },
  });
  const lastStatus = () => statuses.at(-1)?.status;
  return { manager, clear, authFlush, state, sockets, statuses, lastStatus, onAlert };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("connection manager", () => {
  it("stays idle as not_linked when no session is stored", async () => {
    const { manager, sockets, lastStatus } = setup(false);
    await manager.start();
    expect(sockets).toHaveLength(0);
    expect(lastStatus()).toBe("not_linked");
  });

  it("connects a stored session and records the bot identity", async () => {
    const { manager, sockets, statuses } = setup(true);
    const opened = vi.fn();
    manager.onOpen(opened);
    await manager.start();
    sockets[0]?.update({ connection: "open" });
    await flush();
    expect(opened).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toMatchObject({
      status: "connected",
      linked_phone_e164: "+2348012345678",
      bot_jid: "2348012345678@s.whatsapp.net",
      bot_lid: "99887766@lid",
    });
  });

  it("issues a pairing code once the socket is ready", async () => {
    const { manager, sockets, clear, lastStatus } = setup(false);
    const code = manager.pair("+234 801 234 5678");
    await flush();
    expect(clear).toHaveBeenCalled();
    expect(lastStatus()).toBe("pairing");
    sockets[0]?.update({ qr: "ignored-qr" });
    await expect(code).resolves.toBe("ABCD1234");
    expect(sockets[0]?.sock.requestPairingCode).toHaveBeenCalledWith("2348012345678");
  });

  it("refuses to pair when a number is already linked", async () => {
    const { manager } = setup(true);
    await expect(manager.pair("+2348012345678")).rejects.toBeInstanceOf(AlreadyLinkedError);
  });

  it("reconnects immediately after pairing succeeds (restart required)", async () => {
    const { manager, sockets, state, lastStatus } = setup(false);
    const code = manager.pair("+2348012345678");
    await flush();
    sockets[0]?.update({ qr: "x" });
    await code;

    state.registered = true; // phone confirmed the code
    sockets[0]?.close(DisconnectReason.restartRequired);
    await flush();
    expect(sockets).toHaveLength(2);
    sockets[1]?.update({ connection: "open" });
    await flush();
    expect(lastStatus()).toBe("connected");
  });

  it("reports a pairing socket that closes before the code is confirmed", async () => {
    const { manager, sockets, lastStatus } = setup(false);
    const closed = vi.fn();
    manager.onPairingClosed(closed);
    const code = manager.pair("+2348012345678");
    await flush();
    sockets[0]?.update({ qr: "x" });
    await code;
    sockets[0]?.close(DisconnectReason.timedOut);
    await flush();
    expect(closed).toHaveBeenCalledOnce();
    expect(lastStatus()).toBe("not_linked");
    expect(sockets).toHaveLength(1); // no reconnect loop while unlinked
  });

  it("clears the session and alerts on logout from the phone", async () => {
    const { manager, sockets, clear, lastStatus, onAlert } = setup(true);
    await manager.start();
    sockets[0]?.close(DisconnectReason.loggedOut);
    await flush();
    expect(clear).toHaveBeenCalled();
    expect(lastStatus()).toBe("logged_out");
    expect(onAlert).toHaveBeenCalledWith("logged_out", "logged out");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(1);
  });

  it("stops with a conflict when another device replaces the connection", async () => {
    const { manager, sockets, lastStatus, onAlert } = setup(true);
    await manager.start();
    sockets[0]?.close(DisconnectReason.connectionReplaced);
    await flush();
    expect(lastStatus()).toBe("conflict");
    expect(onAlert).toHaveBeenCalledWith("conflict", expect.any(String));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(1);
  });

  it("backs off and reconnects after a lost connection", async () => {
    const { manager, sockets, lastStatus } = setup(true);
    await manager.start();
    sockets[0]?.close(DisconnectReason.connectionLost);
    await flush();
    expect(lastStatus()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
  });

  it("alerts after 10 consecutive failures and resets the count on open", async () => {
    const { manager, sockets, onAlert } = setup(true);
    await manager.start();
    for (let i = 0; i < 10; i++) {
      sockets.at(-1)?.close(DisconnectReason.connectionLost);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(onAlert).toHaveBeenCalledWith("reconnect_failures", "10 reconnect attempts failed");

    sockets.at(-1)?.update({ connection: "open" });
    await flush();
    onAlert.mockClear();
    sockets.at(-1)?.close(DisconnectReason.connectionLost);
    await flush();
    expect(onAlert).not.toHaveBeenCalled();
  });

  it("relink logs out on purpose without raising a logged-out alert", async () => {
    const { manager, sockets, clear, lastStatus, onAlert } = setup(true);
    await manager.start();
    await manager.relink();
    sockets[0]?.close(DisconnectReason.loggedOut); // late event from our own logout
    await flush();
    expect(sockets[0]?.sock.logout).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(lastStatus()).toBe("pairing");
    expect(onAlert).not.toHaveBeenCalled();
  });

  it("stop() closes the socket, flushes auth and never reconnects", async () => {
    const { manager, sockets, authFlush } = setup(true);
    await manager.start();
    await manager.stop();
    sockets[0]?.close(DisconnectReason.connectionLost);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets[0]?.sock.end).toHaveBeenCalled();
    expect(authFlush).toHaveBeenCalled();
    expect(sockets).toHaveLength(1);
  });

  it("opens no socket when this instance does not hold the lock", async () => {
    const { manager, sockets } = setup(true, () => false);
    await manager.start();
    expect(sockets).toHaveLength(0);
    await expect(manager.pair("+2348012345678")).rejects.toThrow();
  });

  it("does not reconnect once the lock is gone", async () => {
    let held = true;
    const { manager, sockets } = setup(true, () => held);
    await manager.start();
    held = false;
    sockets[0]?.close(DisconnectReason.connectionLost);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(1);
  });
});
