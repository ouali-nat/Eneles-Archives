"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { aiAPI } from "@/lib/api";

/**
 * Dictation: press to record, press again to stop, and the speech comes back as text.
 *
 * The state is one small store rather than React state inside the hook, so the control that shows it (the voice button and the recording bar, wherever they are drawn) can read it without the editor threading props through every layer. There is one dictation per page.
 *
 *   idle → requesting (the browser's permission prompt) → recording → processing (transcribing) → success | error → idle
 *
 * A recording can also be cancelled (cancelDictation): the clip is thrown away and nothing is transcribed. A transcription in flight can be cancelled the same way; its answer is then ignored.
 */
export type DictationState = "idle" | "requesting" | "recording" | "processing" | "success" | "error";

interface Dictation {
  state: DictationState;
  /** The live microphone stream while recording, for a level meter. Opened here and nowhere else. */
  stream: MediaStream | null;
  /** When the recording started (performance.now()), for an elapsed timer; null when not recording. */
  startedAt: number | null;
  /** Why the last dictation failed, in one sentence, while the state is "error". */
  error: string | null;
  /** Where the text of the current dictation goes: the assistant's composer, or the editor at the cursor. */
  target: "composer" | "editor" | null;
}

const idle: Dictation = { state: "idle", stream: null, startedAt: null, error: null, target: null };
let current: Dictation = idle;
const listeners = new Set<() => void>();
const set = (next: Partial<Dictation>) => {
  current = { ...current, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The dictation's state and live stream, for whatever draws the voice button. */
export function useDictationState(): Dictation {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => idle,
  );
}

/** How long Success shows before the button looks idle again. An error stays until it is dismissed, a new dictation starts, or ERROR_MS passes. */
const FEEDBACK_MS = 1400;
const ERROR_MS = 12000;

/* The recorder of the one dictation on the page, and the run it belongs to, so cancelDictation can reach it from any control. A cancelled run's late callbacks see a different run number and do nothing. */
let activeRecorder: MediaRecorder | null = null;
let run = 0;
let feedbackTimer = 0;

function stopTracks(recorder: MediaRecorder | null) {
  recorder?.stream.getTracks().forEach((t) => t.stop());
}

/** Throws the current recording (or the transcription in flight) away. Nothing is transcribed or inserted. */
export function cancelDictation() {
  if (current.state !== "requesting" && current.state !== "recording" && current.state !== "processing") return;
  run++;
  activeRecognition?.abort();
  activeRecognition = null;
  const recorder = activeRecorder;
  activeRecorder = null;
  if (recorder) {
    recorder.onstop = null;
    stopTracks(recorder);
    if (recorder.state !== "inactive") recorder.stop();
  }
  window.clearTimeout(feedbackTimer);
  set({ ...idle });
}

/** Clears a failure the reader has read. */
export function dismissDictationError() {
  if (current.state !== "error") return;
  window.clearTimeout(feedbackTimer);
  set({ ...idle });
}

/**
 * How speech is turned into text for this person (the server says, with the assistant's status): their own OpenAI key, the platform's speech service, the development sample, or, when none of those is available, the browser's own speech recognition, which listens live and sends nothing to our server.
 */
export type DictationMode = "own" | "platform" | "local" | "browser";
let dictationMode: DictationMode = "local";
export function setDictationMode(mode: DictationMode) {
  dictationMode = mode;
}

type BrowserRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
const browserRecognition = (): (new () => BrowserRecognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
let activeRecognition: BrowserRecognition | null = null;

export interface DictationOptions {
  /** Where the text goes instead of the hook's onTranscriptAction (the assistant's composer). */
  onTranscript?: (text: string) => void;
}

export function useSpeechRecognition({
  isAuthenticated,
  onTranscriptAction,
  onLogAction,
}: {
  isAuthenticated: boolean;
  onTranscriptAction: (text: string) => void;
  onLogAction: (type: "info" | "error" | "warning", message: string) => void;
}) {
  const { state } = useDictationState();
  const chunks = useRef<Blob[]>([]);

  const settle = useCallback((outcome: "success" | "error", message?: string) => {
    set({ state: outcome, stream: null, startedAt: null, error: outcome === "error" ? (message ?? "Dictation failed.") : null });
    window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => set({ ...idle }), outcome === "error" ? ERROR_MS : FEEDBACK_MS);
  }, []);

  /** Starts a dictation, or stops the one recording so it is transcribed. `options.onTranscript` sends the text somewhere other than the editor. */
  const toggleDictation = useCallback(
    async (options?: DictationOptions) => {
      // Called straight from an onClick, the argument is an event, not options.
      const into = options && typeof options === "object" && "onTranscript" in options ? options.onTranscript : undefined;
      if (!isAuthenticated) {
        onLogAction("error", "Sign in to use dictation.");
        settle("error", "Sign in to use dictation.");
        return;
      }
      if (current.state === "recording") {
        // The recorder's (or the recognizer's) stop handler takes it from here.
        if (activeRecognition) {
          set({ state: "processing", stream: null, startedAt: null });
          activeRecognition.stop();
          return;
        }
        if (activeRecorder && activeRecorder.state !== "inactive") activeRecorder.stop();
        return;
      }
      // A press while the microphone is being requested or the clip is being transcribed does nothing.
      if (current.state === "requesting" || current.state === "processing") return;

      window.clearTimeout(feedbackTimer);
      const mine = ++run;
      set({ ...idle, state: "requesting", target: into ? "composer" : "editor" });

      // No speech service for this person: the browser listens instead, where it can.
      if (dictationMode === "browser") {
        const Recognition = browserRecognition();
        if (!Recognition) {
          const message = "Dictation needs an OpenAI key in AI settings, or a browser with speech recognition (such as Chrome, Edge, or Safari).";
          onLogAction("warning", message);
          settle("error", message);
          return;
        }
        const recognition = new Recognition();
        activeRecognition = recognition;
        recognition.lang = navigator.language || "en-US";
        recognition.continuous = true;
        recognition.interimResults = false;
        let heard = "";
        recognition.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heard += `${e.results[i][0].transcript} `;
        };
        recognition.onerror = (e) => {
          if (mine !== run || e.error === "aborted") return;
          activeRecognition = null;
          const message = e.error === "not-allowed" ? "The browser blocked the microphone. Allow it for this site, then try again." : e.error === "no-speech" ? "No speech was heard. Check the microphone and try again." : "The browser's speech recognition stopped.";
          onLogAction("error", message);
          settle("error", message);
        };
        recognition.onend = () => {
          if (mine !== run || activeRecognition !== recognition) return;
          activeRecognition = null;
          const text = heard.trim();
          if (!text) return settle("error", "No speech was heard. Check the microphone and try again.");
          if (into) into(text);
          else onTranscriptAction(text + " ");
          settle("success");
        };
        try {
          recognition.start();
          set({ state: "recording", stream: null, startedAt: performance.now() });
        } catch {
          activeRecognition = null;
          settle("error", "The browser's speech recognition could not start.");
        }
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        if (mine !== run) return;
        const message = err instanceof Error && err.name === "NotAllowedError" ? "The browser blocked the microphone. Allow it for this site, then try again." : "Could not open the microphone.";
        onLogAction("error", message);
        settle("error", message);
        return;
      }
      if (mine !== run) {
        // Cancelled while the browser was asking.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      activeRecorder = mediaRecorder;
      chunks.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (activeRecorder === mediaRecorder) activeRecorder = null;
        if (mine !== run) return;
        const type = mediaRecorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        if (blob.size < 100) {
          onLogAction("warning", "That was too short to transcribe. Speak for at least a second.");
          settle("error", "That was too short to transcribe. Speak for at least a second.");
          return;
        }
        set({ state: "processing", stream: null, startedAt: null });
        try {
          const result = await aiAPI.transcribeSpeech(blob, `audio.${type.includes("webm") ? "webm" : "mp4"}`);
          if (mine !== run) return;
          const text = result?.text?.trim();
          if (text) {
            if (into) into(text);
            else onTranscriptAction(text + " ");
            settle("success");
          } else {
            onLogAction("warning", "No speech was heard.");
            settle("error", "No speech was heard. Check the microphone and try again.");
          }
        } catch (err) {
          if (mine !== run) return;
          const message = err instanceof Error && err.message ? err.message : "Transcription failed.";
          onLogAction("error", message);
          settle("error", message);
        }
      };
      mediaRecorder.start();
      set({ state: "recording", stream, startedAt: performance.now() });
    },
    [isAuthenticated, onTranscriptAction, onLogAction, settle],
  );

  // Leaving the editor mid-recording must not leave the microphone open.
  useEffect(
    () => () => {
      window.clearTimeout(feedbackTimer);
      run++;
      activeRecognition?.abort();
      activeRecognition = null;
      if (activeRecorder) {
        activeRecorder.onstop = null;
        stopTracks(activeRecorder);
        if (activeRecorder.state !== "inactive") activeRecorder.stop();
        activeRecorder = null;
      }
      set({ ...idle });
    },
    [],
  );

  return { isDictating: state === "recording" || state === "requesting" || state === "processing", toggleDictation, cancelDictation };
}
