// Voice notes recorded in the dashboard (Phase 6, P34). Browsers record WebM/Ogg/MP4 audio, but
// WhatsApp only shows a voice note (waveform, plays inline on every phone) for Ogg/Opus, mono,
// 48 kHz. ffmpeg converts the recording when the post is sent.
//
// ffmpeg comes from the `ffmpeg-static` package. It is loaded at runtime, so a worker without it
// still runs; only voice notes wait (the scheduler logs why).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The bundled ffmpeg binary, or null when ffmpeg-static is not installed. The package downloads
 * the binary when it is installed; if that download failed, the path exists but the file doesn't.
 */
export function bundledFfmpegPath(): string | null {
  try {
    const path = createRequire(import.meta.url)("ffmpeg-static") as unknown;
    return typeof path === "string" && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

export class VoiceConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceConversionError";
  }
}

export type VoiceConverter = (recording: Buffer) => Promise<Buffer>;

export function createVoiceConverter(options: {
  ffmpegPath: string | null;
  timeoutMs?: number;
}): VoiceConverter {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return (recording) =>
    new Promise((resolve, reject) => {
      if (!options.ffmpegPath) {
        reject(new VoiceConversionError("ffmpeg is not installed (ffmpeg-static)"));
        return;
      }
      const ffmpeg = spawn(
        options.ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          "pipe:0",
          "-vn",
          "-ac",
          "1",
          "-ar",
          "48000",
          "-c:a",
          "libopus",
          "-b:a",
          "32k",
          "-f",
          "ogg",
          "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const output: Buffer[] = [];
      let errors = "";
      const timer = setTimeout(() => {
        ffmpeg.kill("SIGKILL");
        reject(new VoiceConversionError(`ffmpeg took longer than ${timeoutMs} ms`));
      }, timeoutMs);
      ffmpeg.stdout.on("data", (chunk: Buffer) => output.push(chunk));
      ffmpeg.stderr.on("data", (chunk: Buffer) => {
        errors = (errors + chunk.toString()).slice(-500);
      });
      ffmpeg.on("error", (error) => {
        clearTimeout(timer);
        reject(new VoiceConversionError(`ffmpeg could not start: ${error.message}`));
      });
      ffmpeg.on("close", (code) => {
        clearTimeout(timer);
        const result = Buffer.concat(output);
        if (code === 0 && result.length > 0) resolve(result);
        else reject(new VoiceConversionError(`ffmpeg failed (${code}): ${errors.trim()}`));
      });
      ffmpeg.stdin.on("error", () => undefined); // ffmpeg may close its input early on bad data
      ffmpeg.stdin.end(recording);
    });
}
