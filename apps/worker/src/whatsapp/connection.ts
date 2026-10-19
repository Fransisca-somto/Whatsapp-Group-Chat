// The single Baileys socket (architecture.md §3 rule 4: only whatsapp/ touches it).
//
// - start(): connects if a linked session is stored; otherwise stays idle as `not_linked`.
//   An unlinked worker never holds a socket open unless a pairing request is in progress.
// - pair(): opens a fresh socket and returns a pairing code once the socket is ready.
// - relink(): logs out the current session on purpose and clears it.
// - Disconnects of a linked session follow the reconnect policy (reconnectPolicy.ts).
import {
  Browsers,
  fetchLatestWaWebVersion,
  jidDecode,
  jidNormalizedUser,
  makeWASocket,
  type AuthenticationState,
  type ConnectionState,
  type WASocket,
} from "baileys";

import type { AlertKind, WaConnectionStatus } from "@soft-agent-support/shared";

import type { ConnectionPatch, ConnectionStore } from "../db/connectionRepo.ts";
import type { Logger } from "../logger.ts";
import type { SupabaseAuthState } from "./authState.ts";
import { decideReconnect } from "./reconnectPolicy.ts";

/** The parts of a Baileys socket this module uses (a fake implements them in tests). */
export type SocketLike = Pick<
  WASocket,
  | "ev"
  | "requestPairingCode"
  | "logout"
  | "end"
  | "user"
  | "groupMetadata"
  | "groupFetchAllParticipating"
  | "signalRepository"
>;
export type SocketFactory = (auth: AuthenticationState) => Promise<SocketLike>;

export type ConnectionManagerOptions = {
  auth: SupabaseAuthState;
  store: ConnectionStore;
  logger: Logger;
  instanceId: string;
  createSocket: SocketFactory;
  onAlert: (kind: AlertKind, detail: string) => void;
  /**
   * Safety net for the single-connection rule: no socket is opened or re-opened unless this
   * returns true (wired to "this instance holds the leader lock").
   */
  canConnect?: () => boolean;
  /** Called for every new socket, before it connects, so feature modules can attach handlers. */
  onSocket?: (sock: SocketLike) => void;
  /** How long to wait for the socket to become ready for a pairing code. */
  pairingReadyTimeoutMs?: number;
  random?: () => number;
};

export type ConnectionManager = {
  start(): Promise<void>;
  /** Opens a socket and resolves with the pairing code to show the owner. */
  pair(phoneE164: string): Promise<string>;
  /** Abandons an unfinished pairing (code expired or cancelled). */
  cancelPairing(reason: string): Promise<void>;
  /** Logs out and clears the stored session, ready for a new pair(). */
  relink(): Promise<void>;
  isRegistered(): boolean;
  /** Fires each time the socket reaches `open` (also after a pairing succeeds). */
  onOpen(listener: (sock: SocketLike) => void): () => void;
  /** Fires when an unfinished pairing socket closes on its own. */
  onPairingClosed(listener: (reason: string) => void): () => void;
  stop(): Promise<void>;
};

export class AlreadyLinkedError extends Error {
  constructor() {
    super("A number is already linked. Use Relink to change it.");
    this.name = "AlreadyLinkedError";
  }
}

type PairingAttempt = {
  digits: string;
  requested: boolean;
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  readyTimer: NodeJS.Timeout;
};

export function createConnectionManager(options: ConnectionManagerOptions): ConnectionManager {
  const {
    auth,
    store,
    instanceId,
    createSocket,
    onAlert,
    pairingReadyTimeoutMs = 30_000,
    random = Math.random,
    canConnect = () => true,
  } = options;
  const log = options.logger.child({ module: "connection" });

  let socket: SocketLike | undefined;
  /** Bumped whenever a socket is replaced or closed on purpose; stale events are ignored. */
  let generation = 0;
  let failures = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let pairing: PairingAttempt | undefined;
  let stopped = false;
  const openListeners = new Set<(sock: SocketLike) => void>();
  const pairingClosedListeners = new Set<(reason: string) => void>();

  async function setStatus(status: WaConnectionStatus, extra: ConnectionPatch = {}) {
    try {
      await store.update({
        status,
        instance_id: instanceId,
        last_heartbeat_at: new Date().toISOString(), // every status change is also a heartbeat
        ...extra,
      });
    } catch (error) {
      log.error({ err: error, status }, "could not record connection status");
    }
  }

  /** Closes the current socket without triggering the reconnect policy. */
  async function closeSocket() {
    generation += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    const current = socket;
    socket = undefined;
    if (!current) return;
    try {
      await current.end(undefined);
    } catch (error) {
      log.warn({ err: error }, "error while closing socket");
    }
  }

  function endPairing(error?: Error) {
    if (!pairing) return;
    clearTimeout(pairing.readyTimer);
    if (error && !pairing.requested) pairing.reject(error);
    pairing = undefined;
  }

  async function openSocket() {
    if (!canConnect()) {
      log.warn("not opening a WhatsApp socket: this instance does not hold the lock");
      return;
    }
    const gen = ++generation;
    const sock = await createSocket(auth.getState());
    if (gen !== generation || stopped || !canConnect()) {
      await sock.end(undefined);
      return;
    }
    socket = sock;
    options.onSocket?.(sock);
    sock.ev.on("creds.update", () => {
      void auth.saveCreds().catch((error: unknown) => {
        log.error({ err: error }, "could not save creds");
      });
    });
    sock.ev.on("connection.update", (update) => {
      if (gen !== generation) return;
      void handleUpdate(sock, update).catch((error: unknown) => {
        log.error({ err: error }, "connection update handler failed");
      });
    });
  }

  async function handleUpdate(sock: SocketLike, update: Partial<ConnectionState>) {
    if (update.qr && pairing && !pairing.requested) {
      // The socket is ready for a pairing code (the QR itself is never used).
      const attempt = pairing;
      attempt.requested = true;
      clearTimeout(attempt.readyTimer);
      try {
        const code = await sock.requestPairingCode(attempt.digits);
        log.info("pairing code issued");
        attempt.resolve(code);
      } catch (error) {
        attempt.reject(error instanceof Error ? error : new Error(String(error)));
        pairing = undefined;
      }
      return;
    }

    if (update.connection === "open") {
      failures = 0;
      endPairing();
      const me = sock.user;
      const phoneDigits = jidDecode(me?.id)?.user;
      await setStatus("connected", {
        linked_phone_e164: phoneDigits ? `+${phoneDigits}` : null,
        bot_jid: me?.id ? jidNormalizedUser(me.id) : null,
        bot_lid: me?.lid ? jidNormalizedUser(me.lid) : null,
        last_connected_at: new Date().toISOString(),
        last_error: null,
      });
      log.info("connected to WhatsApp");
      for (const listener of openListeners) listener(sock);
      return;
    }

    if (update.connection === "close") {
      const statusCode = disconnectStatusCode(update.lastDisconnect?.error);
      await handleClose(statusCode, update.lastDisconnect?.error?.message);
    }
  }

  async function handleClose(statusCode: number | undefined, message: string | undefined) {
    socket = undefined;
    if (stopped) return;

    if (!auth.isRegistered()) {
      // A pairing socket closed before the phone confirmed the code.
      const reason = `pairing connection closed (${statusCode ?? "unknown"})`;
      log.warn({ statusCode }, reason);
      endPairing(new Error(reason));
      await setStatus("not_linked", { last_error: message ?? reason });
      for (const listener of pairingClosedListeners) listener(reason);
      return;
    }

    const decision = decideReconnect(statusCode, failures, random);
    log.warn({ statusCode, decision }, "disconnected from WhatsApp");

    if (decision.action === "logout") {
      await auth.clear();
      await setStatus("logged_out", { last_error: decision.reason });
      onAlert(decision.alert, decision.reason);
      return;
    }
    if (decision.action === "stop") {
      await setStatus("conflict", { last_error: decision.reason });
      onAlert(decision.alert, decision.reason);
      return;
    }

    if (decision.countsAsFailure) failures += 1;
    await setStatus(decision.status, { last_error: decision.reason });
    if (decision.alert) onAlert(decision.alert, `${failures} reconnect attempts failed`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void openSocket().catch((error: unknown) => {
        log.error({ err: error }, "reconnect attempt failed to start");
        void handleClose(undefined, error instanceof Error ? error.message : String(error));
      });
    }, decision.delayMs);
  }

  return {
    async start() {
      if (auth.isRegistered()) {
        await setStatus("connecting");
        await openSocket();
      } else {
        await setStatus("not_linked");
        log.info("no linked session; waiting for a pairing request");
      }
    },

    async pair(phoneE164) {
      if (stopped || !canConnect()) throw new Error("connection manager is stopped");
      if (auth.isRegistered()) throw new AlreadyLinkedError();
      endPairing(new Error("superseded by a new pairing request"));
      await closeSocket();
      // Each attempt starts from fresh creds, never from a half-finished earlier attempt.
      await auth.clear();
      await setStatus("pairing", { last_error: null });
      const code = new Promise<string>((resolve, reject) => {
        pairing = {
          digits: phoneE164.replace(/\D/g, ""),
          requested: false,
          resolve,
          reject,
          readyTimer: setTimeout(() => {
            endPairing(new Error("WhatsApp did not become ready for pairing in time"));
            void closeSocket();
          }, pairingReadyTimeoutMs),
        };
      });
      await openSocket();
      return code;
    },

    async cancelPairing(reason) {
      if (stopped || auth.isRegistered()) return; // the phone confirmed just in time; keep the session
      log.info({ reason }, "pairing abandoned");
      endPairing(new Error(reason));
      await closeSocket();
      // The half-finished pairing may have written creds; start the next attempt clean.
      await auth.clear();
      await setStatus("not_linked");
    },

    async relink() {
      if (stopped) throw new Error("connection manager is stopped");
      endPairing(new Error("relink requested"));
      const current = socket;
      generation += 1; // our own logout must not trigger the logged-out alert
      socket = undefined;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      if (current) {
        try {
          await current.logout("Relink requested from dashboard");
        } catch (error) {
          log.warn({ err: error }, "logout during relink failed; clearing session anyway");
          await current.end(undefined);
        }
      }
      await auth.clear();
      failures = 0;
      await setStatus("pairing", { linked_phone_e164: null, bot_jid: null, bot_lid: null });
      log.info("session cleared for relink");
    },

    isRegistered: () => auth.isRegistered(),

    onOpen(listener) {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },

    onPairingClosed(listener) {
      pairingClosedListeners.add(listener);
      return () => pairingClosedListeners.delete(listener);
    },

    async stop() {
      stopped = true;
      endPairing(new Error("worker stopping"));
      await closeSocket();
      await auth.flush().catch((error: unknown) => {
        log.error({ err: error }, "final auth state flush failed");
      });
    },
  };
}

/** Baileys closes with a Boom error; read its HTTP-style status code without depending on Boom. */
function disconnectStatusCode(error: unknown): number | undefined {
  const code = (error as { output?: { statusCode?: unknown } } | undefined)?.output?.statusCode;
  return typeof code === "number" ? code : undefined;
}

let cachedVersion: Promise<[number, number, number] | undefined> | undefined;

/** Builds real Baileys sockets. Fetches the current WhatsApp Web version once per process. */
export function createBaileysSocketFactory(logger: Logger): SocketFactory {
  const baileysLogger = logger.child({ module: "baileys" }, { level: "warn" });
  return async (auth) => {
    cachedVersion ??= fetchLatestWaWebVersion()
      .then((result) => result.version)
      .catch((error: unknown) => {
        logger.warn({ err: error }, "could not fetch WhatsApp Web version; using bundled default");
        return undefined;
      });
    const version = await cachedVersion;
    return makeWASocket({
      auth,
      logger: baileysLogger,
      browser: Browsers.macOS("Chrome"),
      markOnlineOnConnect: false,
      // No full history download. Baileys' default history filter is kept on purpose: it skips
      // only FULL syncs, and blocking every sync stops Baileys learning LID → phone mappings.
      syncFullHistory: false,
      ...(version ? { version } : {}),
    });
  };
}
