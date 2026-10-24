import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { bundledFfmpegPath, createVoiceConverter, VoiceConversionError } from "./convertVoice.ts";

const ffmpegPath = bundledFfmpegPath();

/** A one-second WebM/Opus clip, the way Chrome records, made with the same ffmpeg. */
function webmClip(path: string): Buffer {
  const result = spawnSync(path, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "libopus",
    "-f",
    "webm",
    "pipe:1",
  ]);
  return result.stdout;
}

describe("voice note conversion (P34)", () => {
  it("explains when ffmpeg is missing", async () => {
    const convert = createVoiceConverter({ ffmpegPath: null });
    await expect(convert(Buffer.from("x"))).rejects.toBeInstanceOf(VoiceConversionError);
  });

  // The first ffmpeg run can take several seconds (the OS loads an 80 MB binary).
  it.skipIf(!ffmpegPath)(
    "turns a browser recording into Ogg/Opus",
    { timeout: 30_000 },
    async () => {
      const convert = createVoiceConverter({ ffmpegPath });
      const output = await convert(webmClip(ffmpegPath!));
      expect(output.subarray(0, 4).toString()).toBe("OggS");
      expect(output.includes(Buffer.from("OpusHead"))).toBe(true);
    },
  );

  it.skipIf(!ffmpegPath)("rejects data that isn't audio", { timeout: 30_000 }, async () => {
    const convert = createVoiceConverter({ ffmpegPath });
    await expect(convert(Buffer.from("not audio at all"))).rejects.toThrow("ffmpeg failed");
  });
});
