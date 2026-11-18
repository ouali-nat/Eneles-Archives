"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, Check, Mic, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DrawnCheck, Spinner } from "@/components/ui/status";
import { useMotion } from "@/hooks/useMotion";
import type { DictationState } from "@/hooks/useSpeechRecognition";
import { cn } from "@/lib/utils";

const LABELS: Record<DictationState, string> = {
  idle: "Dictate",
  requesting: "Waiting for the microphone",
  recording: "Stop and transcribe",
  processing: "Transcribing",
  success: "Dictation added",
  error: "Dictation failed",
};

/**
 * The microphone button that starts dictation. It is a square control at the standard height. Its glyph follows the dictation's state (see useSpeechRecognition): the microphone at rest, a spinner while the browser asks for the microphone or the clip is transcribed, a red dot while recording, a check that draws itself when the text has landed, and an alert after a failure. The recording itself is shown by DictationBar, which a host puts in place of its row of controls.
 *
 * It is a toggle button (aria-pressed while recording) whose accessible name says what a press will do; busy states keep focus and ignore presses instead of turning disabled.
 */
export function VoiceButton({ state, onPress, disabled, size = "icon", className }: { state: DictationState; onPress: () => void; disabled?: boolean; size?: "icon" | "icon-sm"; className?: string }) {
  const busy = state === "requesting" || state === "processing";
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={busy ? undefined : onPress}
      disabled={disabled}
      aria-pressed={state === "recording"}
      aria-busy={busy || undefined}
      aria-label={LABELS[state]}
      title={state === "idle" ? "Dictate: speak, and the words are typed for you" : LABELS[state]}
      data-state={state}
      className={cn("text-muted-foreground hover:text-foreground data-[state=error]:text-danger data-[state=recording]:text-danger data-[state=success]:text-success", className)}
    >
      {state === "idle" && <Mic aria-hidden className="size-4" />}
      {busy && <Spinner className="size-4" />}
      {state === "recording" && <span aria-hidden className="size-2.5 rounded-full bg-danger" />}
      {state === "success" && <DrawnCheck className="size-4" />}
      {state === "error" && <AlertCircle aria-hidden className="size-4" />}
    </Button>
  );
}

/** Minutes and seconds, as a recorder shows them: 0:07, 1:42. */
function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The time since `startedAt`, written into the element twice a second without going through React state. */
function Elapsed({ startedAt }: { startedAt: number | null }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => {
      if (el.current) el.current.textContent = elapsed(performance.now() - startedAt);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return (
    <span ref={el} className="w-10 shrink-0 type-base font-medium tabular-nums text-foreground">
      0:00
    </span>
  );
}

/**
 * A live level meter for a microphone stream: a history of mirrored bars that enter at the right and leave at the left, the way a recorder shows what it has heard. The level is the stream's loudness (RMS) read from an analyser each frame and drawn on a canvas directly; nothing goes through React state. Bars take the element's text color, so the meter follows the theme. Under Reduced and Off motion it draws a still row of short bars instead of moving. It never opens the microphone; it is handed the stream.
 */
export function LevelMeter({ stream, className }: { stream: MediaStream | null; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { animates } = useMotion();

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const context = el.getContext("2d");
    if (!context) return;
    const BAR = 2;
    const GAP = 2;
    const history: number[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = el.clientWidth;
      height = el.clientHeight;
      el.width = Math.max(1, Math.round(width * dpr));
      el.height = Math.max(1, Math.round(height * dpr));
    };
    size();
    const observer = new ResizeObserver(() => {
      size();
      if (!animates) still();
    });
    observer.observe(el);

    const bar = (x: number, h: number) => {
      const top = (height - h) / 2;
      context.beginPath();
      if (typeof context.roundRect === "function") context.roundRect(x * dpr, top * dpr, BAR * dpr, h * dpr, (BAR * dpr) / 2);
      else context.rect(x * dpr, top * dpr, BAR * dpr, h * dpr);
      context.fill();
    };
    const count = () => Math.max(1, Math.floor((width + GAP) / (BAR + GAP)));
    const still = () => {
      context.clearRect(0, 0, el.width, el.height);
      context.fillStyle = getComputedStyle(el).color;
      context.globalAlpha = 0.45;
      for (let i = 0; i < count(); i++) bar(i * (BAR + GAP), BAR);
      context.globalAlpha = 1;
    };

    if (!animates || !stream) {
      still();
      return () => observer.disconnect();
    }

    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    const source = audio.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let last = 0;
    let level = 0;
    let color = getComputedStyle(el).color;
    let colorAt = 0;
    const draw = (now: number) => {
      // The theme can change while recording; the color is read again twice a second, not every frame.
      if (now - colorAt > 500) {
        colorAt = now;
        color = getComputedStyle(el).color;
      }
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      // Speech sits around 0.02 to 0.2 RMS; a square root lifts quiet speech so it reads.
      const rms = Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6);
      level = Math.max(rms, level * 0.85);
      // A new bar every 60ms, so the history moves at an even pace whatever the frame rate.
      if (now - last > 60) {
        last = now;
        history.push(level);
        if (history.length > 400) history.shift();
      }
      context.clearRect(0, 0, el.width, el.height);
      context.fillStyle = color;
      const n = count();
      for (let i = 0; i < n; i++) {
        const value = history[history.length - n + i] ?? 0;
        const x = i * (BAR + GAP);
        // Old bars fade toward the leaving edge.
        context.globalAlpha = Math.min(1, 0.25 + (i / n) * 1.2);
        bar(x, Math.max(BAR, value * height));
      }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      source.disconnect();
      void audio.close();
    };
  }, [stream, animates]);

  return <canvas ref={canvas} aria-hidden className={cn("block h-6 min-w-0 flex-1 text-foreground", className)} />;
}

/**
 * What a host shows in place of its row of controls while a dictation is under way or has just failed: while recording, a red dot, the elapsed time, the live level of the microphone, Cancel, and Done (stop and transcribe); while transcribing, a status line and Cancel; after a failure, the reason in one sentence, Try again, and Dismiss. Every control is at the standard height. Returns nothing in the other states.
 */
export function DictationBar({
  state,
  stream,
  startedAt,
  error,
  onStop,
  onCancel,
  onRetry,
  onDismiss,
  className,
}: {
  state: DictationState;
  stream: MediaStream | null;
  startedAt: number | null;
  error: string | null;
  onStop: () => void;
  onCancel: () => void;
  onRetry?: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  if (state === "recording" || state === "requesting") {
    const waiting = state === "requesting";
    return (
      <div role="group" aria-label="Dictation" data-state={state} className={cn("flex min-h-[var(--control-height)] min-w-0 flex-1 items-center gap-2", className)}>
        <span aria-hidden className={cn("ms-1 size-2.5 shrink-0 rounded-full bg-danger", waiting ? "opacity-40" : "dictation-dot")} />
        {waiting ? <span className="min-w-0 flex-1 truncate type-base text-muted-foreground">Waiting for the microphone</span> : <Elapsed startedAt={startedAt} />}
        {!waiting && <LevelMeter stream={stream} className="text-foreground" />}
        <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel dictation" title="Cancel: throw the recording away (Escape)" className="text-muted-foreground hover:text-foreground">
          <X aria-hidden className="size-4" />
        </Button>
        <Button type="button" size="sm" onClick={onStop} disabled={waiting} aria-label="Stop and transcribe" title="Stop and transcribe">
          <Check aria-hidden className="size-4" />
          Done
        </Button>
        <span className="sr-only" role="status" aria-live="polite">
          {waiting ? "Waiting for the microphone" : "Recording"}
        </span>
      </div>
    );
  }
  if (state === "processing") {
    return (
      <div role="group" aria-label="Dictation" data-state={state} className={cn("flex min-h-[var(--control-height)] min-w-0 flex-1 items-center gap-2", className)}>
        <Spinner className="ms-1 size-4 text-muted-foreground" />
        <span className="assistant-shimmer min-w-0 flex-1 truncate type-base">Transcribing</span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <span className="sr-only" role="status" aria-live="polite">
          Transcribing
        </span>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div role="group" aria-label="Dictation" data-state={state} className={cn("flex min-h-[var(--control-height)] min-w-0 flex-1 items-center gap-2", className)}>
        <AlertCircle aria-hidden className="ms-1 size-4 shrink-0 text-danger" />
        <span className="line-clamp-2 min-w-0 flex-1 type-small text-foreground" title={error ?? undefined}>
          {error ?? "Dictation failed."}
        </span>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss" title="Dismiss" className="text-muted-foreground hover:text-foreground">
          <X aria-hidden className="size-4" />
        </Button>
        <span className="sr-only" role="alert">
          {error ?? "Dictation failed."}
        </span>
      </div>
    );
  }
  return null;
}
