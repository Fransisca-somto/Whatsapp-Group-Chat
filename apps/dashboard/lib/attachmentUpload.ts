// Uploads straight from the browser to the private post-attachments bucket with the signed-in
// user's session (storage policies allow dashboard users only). Large files never pass through
// the dashboard server, so its request-size limit does not apply (Phase 6, 6.7).
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MAX_BYTES,
  attachmentKindFor,
  baseMime,
  storageFileName,
  type Attachment,
} from "@soft-agent-support/shared";

import { createClient } from "@/lib/supabase/client";

export type UploadResult = { ok: true; attachment: Attachment } | { ok: false; error: string };

/** Checks a picked file before uploading it (P27). */
export function checkFile(file: { type: string; size: number }): string | null {
  if (!attachmentKindFor(file.type)) {
    return "That file type can't be sent. Use a photo, MP4 video, audio file, PDF or Office document.";
  }
  if (file.size > ATTACHMENT_MAX_BYTES) return "Files can be up to 16 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

async function upload(
  data: Blob,
  name: string,
  mime: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const path = `${crypto.randomUUID()}/${storageFileName(name)}`;
  const { error } = await createClient()
    .storage.from(ATTACHMENT_BUCKET)
    .upload(path, data, { contentType: baseMime(mime), upsert: false });
  if (error) {
    console.error("attachment upload failed", error);
    return { ok: false, error: "The upload failed. Check your connection and try again." };
  }
  return { ok: true, path };
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const problem = checkFile(file);
  if (problem) return { ok: false, error: problem };
  const result = await upload(file, file.name, file.type);
  if (!result.ok) return result;
  return {
    ok: true,
    attachment: {
      path: result.path,
      kind: attachmentKindFor(file.type)!,
      mime: baseMime(file.type),
      name: file.name.slice(0, 200),
      size: file.size,
      seconds: null,
    },
  };
}

/** A voice note recorded in the browser (P28). */
export async function uploadVoiceNote(recording: Blob, seconds: number): Promise<UploadResult> {
  if (recording.size > ATTACHMENT_MAX_BYTES)
    return { ok: false, error: "That recording is too large." };
  const mime = baseMime(recording.type || "audio/webm");
  const extension = mime === "audio/ogg" ? "ogg" : mime === "audio/mp4" ? "m4a" : "webm";
  const result = await upload(recording, `voice-note.${extension}`, mime);
  if (!result.ok) return result;
  return {
    ok: true,
    attachment: {
      path: result.path,
      kind: "voice",
      mime,
      name: "Voice note",
      size: recording.size,
      seconds: Math.max(1, Math.round(seconds)),
    },
  };
}

/** Removes a file uploaded in this form but never saved with a post. Best effort. */
export async function discardUpload(path: string): Promise<void> {
  const { error } = await createClient().storage.from(ATTACHMENT_BUCKET).remove([path]);
  if (error) console.error("could not remove an unsaved upload", error);
}
