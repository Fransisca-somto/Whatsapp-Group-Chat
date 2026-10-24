// The one path for outgoing WhatsApp messages (architecture.md §10, api-interfaces.md §4.3).
// One message at a time, at least 1.5 s apart plus random jitter, and "typing…" for 2–4 s
// before AI replies, so the bot never sends in bursts (ban mitigation). Scheduled posts may
// carry one attachment (Phase 6, 6.8): photos, videos and documents take the text as caption;
// WhatsApp audio and voice notes can't, so the scheduler sends their text separately.
import type { AnyMessageContent, WAMessage } from "baileys";

import type { Logger } from "../logger.ts";
import type { SocketLike } from "./connection.ts";

/** A file to send. `voice` must already be Ogg/Opus (see media/convertVoice.ts). */
export type OutgoingMedia =
  | { kind: "image" | "video" | "audio"; data: Buffer; mimetype: string }
  | { kind: "document"; data: Buffer; mimetype: string; fileName: string }
  | { kind: "voice"; data: Buffer; seconds: number | null };

export type OutgoingMessage = {
  groupJid: string;
  /** The message, or the caption of a photo, video or document (may be empty with media). */
  text: string;
  /** One attachment (scheduled posts only). */
  media?: OutgoingMedia;
  /** The message being answered; the reply quotes it. */
  quoted?: WAMessage;
  /** Show "typing…" first (AI replies). */
  showTyping?: boolean;
};

export class SendError extends Error {
  constructor(
    readonly reason: "not_connected" | "send_failed" | "timeout" | "stopped",
    message: string,
  ) {
    super(message);
    this.name = "SendError";
  }
}

export type SendQueue = {
  /** Resolves with the sent message's WhatsApp ID once it has gone out. */
  enqueue(message: OutgoingMessage): Promise<{ waMessageId: string }>;
  /** Rejects anything still waiting; used when the leader session stops. */
  stop(): void;
};

type Options = {
  getSocket: () => SocketLike | null;
  logger: Logger;
  minGapMs?: number;
  jitterMs?: number;
  typingMinMs?: number;
  typingMaxMs?: number;
  sendTimeoutMs?: number;
  /** P31: media takes longer to upload, so WhatsApp gets longer to confirm it. */
  mediaSendTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createSendQueue(options: Options): SendQueue {
  const {
    getSocket,
    minGapMs = 1_500,
    jitterMs = 1_000,
    typingMinMs = 2_000,
    typingMaxMs = 4_000,
    sendTimeoutMs = 15_000,
    mediaSendTimeoutMs = 60_000,
    sleep = defaultSleep,
    random = Math.random,
    now = Date.now,
  } = options;
  const log = options.logger.child({ module: "send" });
  let tail: Promise<unknown> = Promise.resolve();
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let stopped = false;

  async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new SendError("timeout", `no confirmation within ${ms} ms`)),
        ms,
      );
    });
    try {
      return await Promise.race([task, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendNow(message: OutgoingMessage): Promise<{ waMessageId: string }> {
    if (stopped) throw new SendError("stopped", "send queue stopped");
    const gap = minGapMs + random() * jitterMs;
    const wait = lastSentAt + gap - now();
    if (wait > 0) await sleep(wait);

    const sock = getSocket();
    if (!sock) throw new SendError("not_connected", "WhatsApp is not connected");

    if (message.showTyping) {
      // Presence is cosmetic: a failure here must not stop the reply.
      await sock.sendPresenceUpdate("composing", message.groupJid).catch((error: unknown) => {
        log.debug({ err: error }, "could not show typing");
      });
      await sleep(typingMinMs + random() * (typingMaxMs - typingMinMs));
    }
    if (stopped) throw new SendError("stopped", "send queue stopped");

    let sent: WAMessage | undefined;
    try {
      sent = await withTimeout(
        sock.sendMessage(
          message.groupJid,
          messageContent(message),
          message.quoted ? { quoted: message.quoted } : {},
        ),
        message.media ? mediaSendTimeoutMs : sendTimeoutMs,
      );
    } catch (error) {
      if (error instanceof SendError) throw error;
      throw new SendError("send_failed", `sendMessage failed: ${String(error)}`);
    } finally {
      lastSentAt = now();
      if (message.showTyping) {
        void sock.sendPresenceUpdate("paused", message.groupJid).catch(() => undefined);
      }
    }
    const waMessageId = sent?.key.id;
    if (!waMessageId) throw new SendError("send_failed", "WhatsApp returned no message ID");
    return { waMessageId };
  }

  return {
    enqueue(message) {
      if (!message.media && !message.text.trim()) {
        return Promise.reject(new SendError("send_failed", "nothing to send"));
      }
      const result = tail.then(() => sendNow(message));
      tail = result.catch(() => undefined); // one failure never blocks the queue
      return result;
    },
    stop() {
      stopped = true;
    },
  };
}

/** The Baileys message for a text or one attachment (captions only where WhatsApp allows them). */
export function messageContent(message: OutgoingMessage): AnyMessageContent {
  const media = message.media;
  const caption = message.text.trim() || undefined;
  if (!media) return { text: message.text };
  switch (media.kind) {
    case "image":
      return { image: media.data, mimetype: media.mimetype, caption };
    case "video":
      return { video: media.data, mimetype: media.mimetype, caption };
    case "document":
      return {
        document: media.data,
        mimetype: media.mimetype,
        fileName: media.fileName,
        caption,
      };
    case "audio":
      return { audio: media.data, mimetype: media.mimetype, ptt: false };
    case "voice":
      return {
        audio: media.data,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
        ...(media.seconds ? { seconds: media.seconds } : {}),
      };
  }
}
