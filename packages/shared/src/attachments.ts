// Attachments on dashboard posts (Workflow/Phases/09-Post-Attachments.md P27–P32, ADR-036). A
// person uploads or records them; the AI never creates, edits or chooses media.
import { z } from "zod";

export const ATTACHMENT_BUCKET = "post-attachments";
/** P27: WhatsApp's safe limit for media. Mirrors the bucket's limit in migration 0014. */
export const ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024;
/** P28: longest voice note recorded in the dashboard. */
export const VOICE_MAX_SECONDS = 5 * 60;

export const attachmentKindSchema = z.enum(["image", "video", "audio", "voice", "document"]);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

/** Uploaded files by type (P27). Recordings (`voice`) are separate: see VOICE_MIME_TYPES. */
const FILE_KINDS: Record<string, Exclude<AttachmentKind, "voice">> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/ogg": "audio",
  "audio/aac": "audio",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "text/plain": "document",
};

/** What browsers record in (the worker converts it to a WhatsApp voice note, P34). */
export const VOICE_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/mp4"] as const;

/** Every type the storage bucket accepts (migration 0014 lists the same). */
export const ATTACHMENT_MIME_TYPES = [
  ...new Set([...Object.keys(FILE_KINDS), ...VOICE_MIME_TYPES]),
].sort();

/** "audio/webm;codecs=opus" → "audio/webm". */
export function baseMime(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

/** The kind for an uploaded file's type, or null if it is not allowed. */
export function attachmentKindFor(mime: string): Exclude<AttachmentKind, "voice"> | null {
  return FILE_KINDS[baseMime(mime)] ?? null;
}

/** File picker `accept` list. */
export const ATTACHMENT_ACCEPT = Object.keys(FILE_KINDS).join(",");

/** What a saved post stores about its attachment. */
export const attachmentSchema = z
  .object({
    /** Path inside the bucket, e.g. "3f0c…/report.pdf". */
    path: z
      .string()
      .min(3)
      .max(300)
      .regex(/^[0-9a-f-]{36}\/[^/]+$/, "Unknown file"),
    kind: attachmentKindSchema,
    mime: z.string().min(3).max(150),
    name: z.string().trim().min(1).max(200),
    size: z.number().int().positive().max(ATTACHMENT_MAX_BYTES, "Files can be up to 16 MB"),
    /** Length of a voice note; null for everything else. */
    seconds: z.number().int().positive().max(VOICE_MAX_SECONDS).nullable(),
  })
  .refine(
    (a) =>
      a.kind === "voice"
        ? (VOICE_MIME_TYPES as readonly string[]).includes(baseMime(a.mime)) && a.seconds !== null
        : attachmentKindFor(a.mime) === a.kind,
    { message: "That file type can't be sent", path: ["mime"] },
  );
export type Attachment = z.infer<typeof attachmentSchema>;

/** A safe storage file name: letters, digits, dots, dashes and underscores only. */
export function storageFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return (cleaned || "file").slice(-120);
}

/** "2.4 MB", "830 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
