import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import type { SocketLike } from "./connection.ts";
import { createSendQueue, messageContent, SendError } from "./sendQueue.ts";

const logger = pino({ level: "silent" });
const GROUP = "120363000000000001@g.us";

function setup(options: { failFirst?: boolean } = {}) {
  let clock = 0;
  const log: string[] = [];
  let sent = 0;
  const sock = {
    sendPresenceUpdate: vi.fn((type: string) => {
      log.push(`presence:${type}@${clock}`);
      return Promise.resolve();
    }),
    sendMessage: vi.fn((_jid: string, content: { text: string }) => {
      log.push(`send:${content.text}@${clock}`);
      sent += 1;
      if (options.failFirst && sent === 1) return Promise.reject(new Error("Connection Closed"));
      return Promise.resolve({ key: { id: `OUT${sent}` } });
    }),
  };
  let connected = true;
  const queue = createSendQueue({
    getSocket: () => (connected ? (sock as unknown as SocketLike) : null),
    logger,
    random: () => 0.5,
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
  });
  return { queue, sock, log, disconnect: () => (connected = false) };
}

describe("send queue", () => {
  it("sends one at a time with a gap of at least 1.5 s plus jitter", async () => {
    const t = setup();
    const results = await Promise.all([
      t.queue.enqueue({ groupJid: GROUP, text: "one" }),
      t.queue.enqueue({ groupJid: GROUP, text: "two" }),
    ]);
    expect(results).toEqual([{ waMessageId: "OUT1" }, { waMessageId: "OUT2" }]);
    // random() = 0.5 → gap 1,500 + 500 ms
    expect(t.log).toEqual(["send:one@0", "send:two@2000"]);
  });

  it("shows typing for 2–4 s before an AI reply, then quotes the question", async () => {
    const t = setup();
    const quoted = { key: { id: "Q1" } } as never;
    await t.queue.enqueue({ groupJid: GROUP, text: "hi", showTyping: true, quoted });
    expect(t.log.slice(0, 2)).toEqual(["presence:composing@0", "send:hi@3000"]);
    expect(t.sock.sendMessage).toHaveBeenCalledWith(GROUP, { text: "hi" }, { quoted });
  });

  it("keeps going after a failed send", async () => {
    const t = setup({ failFirst: true });
    const first = t.queue.enqueue({ groupJid: GROUP, text: "one" });
    const second = t.queue.enqueue({ groupJid: GROUP, text: "two" });
    await expect(first).rejects.toMatchObject({ reason: "send_failed" });
    await expect(second).resolves.toEqual({ waMessageId: "OUT2" });
  });

  it("refuses to send without a socket or after stop", async () => {
    const t = setup();
    t.disconnect();
    await expect(t.queue.enqueue({ groupJid: GROUP, text: "x" })).rejects.toBeInstanceOf(SendError);
    const u = setup();
    u.queue.stop();
    await expect(u.queue.enqueue({ groupJid: GROUP, text: "x" })).rejects.toMatchObject({
      reason: "stopped",
    });
  });
});

describe("messageContent (6.8)", () => {
  const data = Buffer.from("x");
  const at = (media: Parameters<typeof messageContent>[0]["media"], text = "Caption") =>
    messageContent({ groupJid: GROUP, text, media });

  it("puts the text as caption on photos, videos and documents", () => {
    expect(at({ kind: "image", data, mimetype: "image/png" })).toEqual({
      image: data,
      mimetype: "image/png",
      caption: "Caption",
    });
    expect(at({ kind: "video", data, mimetype: "video/mp4" }, "")).toEqual({
      video: data,
      mimetype: "video/mp4",
      caption: undefined,
    });
    expect(at({ kind: "document", data, mimetype: "application/pdf", fileName: "a.pdf" })).toEqual({
      document: data,
      mimetype: "application/pdf",
      fileName: "a.pdf",
      caption: "Caption",
    });
  });

  it("sends audio as playable audio and a voice note as Ogg/Opus voice, never with a caption", () => {
    expect(at({ kind: "audio", data, mimetype: "audio/mpeg" })).toEqual({
      audio: data,
      mimetype: "audio/mpeg",
      ptt: false,
    });
    expect(at({ kind: "voice", data, seconds: 12 })).toEqual({
      audio: data,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
      seconds: 12,
    });
  });

  it("is plain text without media", () => {
    expect(messageContent({ groupJid: GROUP, text: "Hello" })).toEqual({ text: "Hello" });
  });
});
