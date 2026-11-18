"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AssistantActivity } from "./types";

/**
 * An answer while it is written. The server streams it (text deltas, the files read and changed, notices); `LiveAnswer` collects them and tells its readers at most once a frame, however fast the deltas come, so a burst of tiny chunks costs one render. `usePacedText` then lets the text out smoothly: a backlog that arrived in one burst is released over a few frames instead of appearing as a jump, and the release speeds up with the backlog, so it never falls far behind the model.
 */

export interface LiveMeta {
  model: string;
  providerName: string;
  source: string;
  tools: boolean;
  trimmed: { sent: number; total: number } | null;
}

export interface LiveSnapshot {
  text: string;
  activities: AssistantActivity[];
  notices: string[];
  meta: LiveMeta | null;
  /** The stream has ended (answered, failed, or stopped). */
  done: boolean;
  version: number;
}

export class LiveAnswer {
  private snapshot: LiveSnapshot = { text: "", activities: [], notices: [], meta: null, done: false, version: 0 };
  private listeners = new Set<() => void>();
  private frame = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = () => this.snapshot;

  private change(next: Partial<LiveSnapshot>, now = false) {
    this.snapshot = { ...this.snapshot, ...next, version: this.snapshot.version + 1 };
    if (now) {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.listeners.forEach((l) => l());
      return;
    }
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.listeners.forEach((l) => l());
      });
  }

  text(delta: string) {
    this.change({ text: this.snapshot.text + delta });
  }

  activity(activity: AssistantActivity) {
    const list = this.snapshot.activities;
    const at = list.findIndex((a) => a.id === activity.id);
    // A call that started without its path gets it when it finishes.
    const merged = at === -1 ? [...list, activity] : list.map((a, i) => (i === at ? { ...a, ...activity, path: activity.path ?? a.path } : a));
    this.change({ activities: merged });
  }

  notice(message: string) {
    if (!this.snapshot.notices.includes(message)) this.change({ notices: [...this.snapshot.notices, message] });
  }

  meta(meta: LiveMeta) {
    this.change({ meta });
  }

  finish() {
    this.change({ done: true }, true);
  }
}

export function useLiveAnswer(live: LiveAnswer): LiveSnapshot {
  return useSyncExternalStore(live.subscribe, live.get, live.get);
}

/** Whether the reader asked for full motion (the app's Motion setting); reduced and off show text as it arrives. */
const fullMotion = () => typeof document !== "undefined" && (document.documentElement.dataset.motion ?? "full") === "full";

/**
 * How much of `target` to show. While `streaming`, the shown text runs after the target at a pace that grows with the backlog (about a fifth of it a frame, at least two characters), so bursts read as a steady stream. Once the stream has ended the rest is let out at the same pace, and `onCaughtUp` is called when everything shows. Without full motion the whole target shows at once.
 */
export function usePacedText(target: string, streaming: boolean, onCaughtUp?: () => void): string {
  const [shown, setShown] = useState(() => (streaming ? 0 : target.length));
  const shownRef = useRef(shown);
  const caughtUp = useRef(onCaughtUp);
  useEffect(() => {
    caughtUp.current = onCaughtUp;
  });

  useEffect(() => {
    let frame = 0;
    const step = () => {
      frame = 0;
      const backlog = target.length - shownRef.current;
      if (backlog <= 0) {
        if (!streaming) caughtUp.current?.();
        return;
      }
      const next = fullMotion() ? Math.min(target.length, shownRef.current + Math.max(2, Math.ceil(backlog / (streaming ? 5 : 3)))) : target.length;
      shownRef.current = next;
      setShown(next);
      frame = requestAnimationFrame(step);
    };
    // A target that shrank (a new answer in the same place) starts again from what fits.
    if (shownRef.current > target.length) {
      shownRef.current = target.length;
      setShown(target.length);
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, streaming]);

  return target.slice(0, Math.min(shown, target.length));
}

/**
 * Markdown cut where it is half written, so a partly written answer never flashes raw syntax or a math error: an unclosed code fence is closed; a display math block that has not ended is held back, and so is a short inline math span; a table row still being written is held back until its line ends; an unclosed inline code span or bold run at the very end is closed.
 */
export function settlePartialMarkdown(text: string): string {
  let out = text;
  const fences = out.match(/^\s*(```|~~~)/gm)?.length ?? 0;
  if (fences % 2 === 1) return `${out}\n\`\`\``;

  const blocks = out.split("$$").length - 1;
  if (blocks % 2 === 1) out = out.slice(0, out.lastIndexOf("$$"));
  else {
    // Single dollars outside $$ blocks and code, not escaped: an odd count means an inline span is still open. It is held back only while it could still be math (short, and in the same paragraph).
    const plain = out.replace(/\$\$[\s\S]*?\$\$/g, "").replace(/`[^`\n]*`/g, "");
    const singles = plain.match(/(?<!\\)\$/g)?.length ?? 0;
    if (singles % 2 === 1) {
      const at = out.lastIndexOf("$");
      const rest = out.slice(at + 1);
      if (rest.length < 160 && !rest.includes("\n\n")) out = out.slice(0, at);
    }
  }

  // The row of a table still being written: its line has not ended.
  const lastBreak = out.lastIndexOf("\n");
  const lastLine = out.slice(lastBreak + 1);
  if (/^\s*\|/.test(lastLine)) out = out.slice(0, lastBreak + 1);

  // An inline code span or a bold run left open at the end of the last paragraph.
  const paragraph = out.slice(out.lastIndexOf("\n\n") + 1);
  if ((paragraph.match(/`/g)?.length ?? 0) % 2 === 1) out += "`";
  else if ((paragraph.replace(/`[^`]*`/g, "").match(/\*\*/g)?.length ?? 0) % 2 === 1) out += "**";
  return out;
}

/**
 * Splits Markdown into blocks at blank lines that are outside code fences and display math, so a streamed answer renders block by block: finished blocks are memoized and never parsed or typeset again, and only the block being written changes each frame. A block that starts indented (a list item's continuation) stays with the block before it, so lists and their paragraphs keep their meaning.
 */
export function splitBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let math = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = null;
    } else if (!fence) {
      const count = line.split("$$").length - 1;
      if (count % 2 === 1) math = !math;
    }
    const blank = !fence && !math && line.trim() === "";
    const next = lines[i + 1];
    if (blank && current.length && next !== undefined && next.trim() !== "" && !/^\s/.test(next)) {
      blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}
