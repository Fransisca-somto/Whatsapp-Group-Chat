"use client";

import { VOICE_MAX_SECONDS } from "@soft-agent-support/shared";
import { Check, Mic, RotateCcw, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/** Browsers record in one of these; the worker converts it to a WhatsApp voice note (P34). */
const PREFERRED_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

function pickType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

type State =
  | { step: "idle" }
  | { step: "recording"; seconds: number }
  | { step: "recorded"; blob: Blob; seconds: number; url: string };

/**
 * Records a voice note with the microphone (P28): up to 5 minutes, listen back, re-record or use
 * it. Nothing leaves the browser until "Use recording".
 */
export function VoiceRecorder({
  onUse,
  onCancel,
  disabled,
}: {
  onUse: (recording: Blob, seconds: number) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(0);

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };

  useEffect(() => release, []);
  useEffect(
    () => () => {
      if (state.step === "recorded") URL.revokeObjectURL(state.url);
    },
    [state],
  );

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  const start = async () => {
    setError(null);
    const type = pickType();
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser can't record audio. Try Chrome, Edge or Firefox, or attach an audio file.",
      );
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(
        "The microphone is blocked. Allow microphone access for this site in the browser, then try again.",
      );
      return;
    }
    const chunks: Blob[] = [];
    const media = new MediaRecorder(stream.current, { mimeType: type });
    recorder.current = media;
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = () => {
      const seconds = Math.min(VOICE_MAX_SECONDS, (Date.now() - started.current) / 1000);
      release();
      const blob = new Blob(chunks, { type: media.mimeType || type });
      setState({ step: "recorded", blob, seconds, url: URL.createObjectURL(blob) });
    };
    started.current = Date.now();
    media.start();
    setState({ step: "recording", seconds: 0 });
    timer.current = setInterval(() => {
      const seconds = (Date.now() - started.current) / 1000;
      if (seconds >= VOICE_MAX_SECONDS) stop();
      else setState({ step: "recording", seconds });
    }, 250);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      {state.step === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void start()} disabled={disabled}>
            <Mic aria-hidden="true" />
            Start recording
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <span className="text-xs text-muted-foreground">Up to 5 minutes.</span>
        </div>
      )}
      {state.step === "recording" && (
        <div className="flex flex-wrap items-center gap-3" aria-live="polite">
          <span className="flex items-center gap-2 text-sm font-medium text-status-error">
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-current" />
            Recording {clock(state.seconds)} / {clock(VOICE_MAX_SECONDS)}
          </span>
          <Button type="button" variant="outline" onClick={stop}>
            <Square aria-hidden="true" />
            Stop
          </Button>
        </div>
      )}
      {state.step === "recorded" && (
        <div className="flex flex-col gap-2">
          <audio controls src={state.url} className="w-full" aria-label="Your recording" />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => onUse(state.blob, state.seconds)}
              disabled={disabled || state.seconds < 1}
            >
              <Check aria-hidden="true" />
              Use recording ({clock(state.seconds)})
            </Button>
            <Button type="button" variant="outline" onClick={() => setState({ step: "idle" })}>
              <RotateCcw aria-hidden="true" />
              Record again
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              <X aria-hidden="true" />
              Discard
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
