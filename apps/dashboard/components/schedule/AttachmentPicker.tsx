"use client";

import { ATTACHMENT_ACCEPT, formatFileSize, type Attachment } from "@soft-agent-support/shared";
import {
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Mic,
  Music,
  Paperclip,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { uploadFile, uploadVoiceNote } from "@/lib/attachmentUpload";
import { attachmentLabel } from "@/lib/schedule";

import { VoiceRecorder } from "./VoiceRecorder";

const ICONS = { image: ImageIcon, video: Film, audio: Music, voice: Mic, document: FileText };

/**
 * One attachment for a post (P27, P28): attach a file or record a voice note, with a preview.
 * `previewUrl` is a local link to a file picked in this form (shown for photos, video and audio).
 */
export function AttachmentPicker({
  value,
  previewUrl,
  onUploaded,
  onRemove,
  disabled,
}: {
  value: Attachment | null;
  previewUrl: string | null;
  onUploaded: (attachment: Attachment, previewUrl: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (result: Awaited<ReturnType<typeof uploadFile>>, data: Blob) => {
    setUploading(false);
    if (result.ok) {
      setRecording(false);
      onUploaded(result.attachment, URL.createObjectURL(data));
    } else {
      setError(result.error);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    finish(await uploadFile(file), file);
  };

  const saveRecording = async (blob: Blob, seconds: number) => {
    setError(null);
    setUploading(true);
    finish(await uploadVoiceNote(blob, seconds), blob);
  };

  if (value) {
    const Icon = ICONS[value.kind];
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        {previewUrl && value.kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview, not a page image
          <img src={previewUrl} alt="" className="max-h-48 w-fit rounded-md object-contain" />
        )}
        {previewUrl && value.kind === "video" && (
          <video src={previewUrl} controls className="max-h-48 w-fit rounded-md" />
        )}
        {previewUrl && (value.kind === "audio" || value.kind === "voice") && (
          <audio src={previewUrl} controls className="w-full" aria-label="Attached audio" />
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 text-sm">
            <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{attachmentLabel(value)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatFileSize(value.size)}
            </span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove attachment"
            disabled={disabled}
            onClick={onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {recording ? (
        <VoiceRecorder
          onUse={(blob, seconds) => void saveRecording(blob, seconds)}
          onCancel={() => setRecording(false)}
          disabled={disabled || uploading}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || uploading}
            onClick={() => input.current?.click()}
          >
            <Paperclip aria-hidden="true" />
            Attach file
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || uploading}
            onClick={() => setRecording(true)}
          >
            <Mic aria-hidden="true" />
            Record voice note
          </Button>
          <span className="text-xs text-muted-foreground">
            Optional. Photo, video, audio or document, up to 16 MB.
          </span>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a file to attach"
        onChange={(event) => {
          void pickFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {uploading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          Uploading…
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
