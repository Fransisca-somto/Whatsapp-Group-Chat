import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_MIME_TYPES,
  attachmentKindFor,
  attachmentSchema,
  formatFileSize,
  storageFileName,
} from "./attachments.ts";
import { formatScheduledPost } from "./scheduledPosts.ts";
import { scheduledPostInputSchema } from "./schemas/scheduledPost.ts";

const PATH = "3f0c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b/report.pdf";

describe("attachment types (P27)", () => {
  it("maps allowed files to their kind, ignoring codec details", () => {
    expect(attachmentKindFor("image/jpeg")).toBe("image");
    expect(attachmentKindFor("video/mp4")).toBe("video");
    expect(attachmentKindFor("audio/mpeg")).toBe("audio");
    expect(attachmentKindFor("audio/ogg; codecs=opus")).toBe("audio");
    expect(attachmentKindFor("application/pdf")).toBe("document");
    expect(
      attachmentKindFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("document");
  });

  it("refuses anything else", () => {
    for (const mime of ["image/gif", "application/zip", "video/quicktime", "text/html", ""]) {
      expect(attachmentKindFor(mime)).toBeNull();
    }
  });

  it("lists the recording formats for the bucket too", () => {
    expect(ATTACHMENT_MIME_TYPES).toContain("audio/webm");
    expect(ATTACHMENT_MIME_TYPES).toContain("application/pdf");
  });
});

describe("attachmentSchema", () => {
  const pdf = {
    path: PATH,
    kind: "document",
    mime: "application/pdf",
    name: "Report.pdf",
    size: 120_000,
    seconds: null,
  };

  it("accepts a file whose type matches its kind, and a voice note with its length", () => {
    expect(attachmentSchema.safeParse(pdf).success).toBe(true);
    expect(
      attachmentSchema.safeParse({
        ...pdf,
        kind: "voice",
        mime: "audio/webm;codecs=opus",
        name: "Voice note",
        seconds: 42,
      }).success,
    ).toBe(true);
  });

  it("refuses a mismatched type, a voice note without length, over 16 MB or 5 minutes", () => {
    const ok = (change: object) => attachmentSchema.safeParse({ ...pdf, ...change }).success;
    expect(ok({ kind: "image" })).toBe(false);
    expect(ok({ kind: "voice", mime: "audio/webm" })).toBe(false); // no seconds
    expect(ok({ size: 16 * 1024 * 1024 + 1 })).toBe(false);
    expect(ok({ kind: "voice", mime: "audio/webm", seconds: 301 })).toBe(false);
    expect(ok({ path: "../etc/passwd" })).toBe(false);
  });
});

describe("posts with attachments (P32)", () => {
  const post = {
    groupId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
    kind: "announcement",
    body: "",
    dueAtLocal: "2026-10-30T09:00",
    repeat: null,
  };
  const attachment = {
    path: PATH,
    kind: "image",
    mime: "image/png",
    name: "poster.png",
    size: 2_000,
    seconds: null,
  };

  it("allows empty text only with an attachment", () => {
    expect(scheduledPostInputSchema.safeParse({ ...post, attachment }).success).toBe(true);
    expect(scheduledPostInputSchema.safeParse(post).error?.issues[0]?.message).toBe(
      "Write the message",
    );
  });

  it("labels a reminder with no text", () => {
    expect(formatScheduledPost("reminder", "")).toBe("*Reminder*");
    expect(formatScheduledPost("announcement", "")).toBe("");
  });
});

describe("file helpers", () => {
  it("makes safe storage names", () => {
    expect(storageFileName("Q3 Report (final)!.pdf")).toBe("Q3-Report-final-.pdf");
    expect(storageFileName("../../x")).toBe("x");
    expect(storageFileName("???")).toBe("file");
  });

  it("formats sizes", () => {
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatFileSize(830 * 1024)).toBe("830 KB");
    expect(formatFileSize(10)).toBe("1 KB");
  });
});
