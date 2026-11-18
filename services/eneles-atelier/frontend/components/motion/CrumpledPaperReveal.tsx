"use client";

import { Children, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Shrink } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMotion } from "@/hooks/useMotion";
import type { SheetHandle, SheetOptions } from "@/lib/motion/crumple/engine";
import { readMs, scrollParent } from "@/lib/motion/dom";
import { canHover } from "@/lib/motion/spring";
import { cn } from "@/lib/utils";

/* A sheet of paper (a note, a letter, a print) that lies on the page crumpled into a ball and opens out into a flat sheet that keeps its creases, under a low raking light that follows the pointer. Behavior after Framer's CrumpledPaperReveal (its trigger set, its controls, and the idea of crease memory were studied; none of its code, data, or constants were used): the crumple is our own XPBD paper solver run in the browser (lib/motion/crumple/simulation.ts), the crease memory our own GPU Voronoi crease map (shaders.ts), and the content real DOM painted onto the paper while it moves by our own DOM painter (domPaint.ts) and shown live once it lies flat. Credits for the shared techniques are in those files: the PCG hash (Jarzynski and Olano 2020), XPBD (Macklin, Muller, and Chentanez 2016), normal mapping without precomputed tangents (Schuler 2013), the GGX lobe, and three.js's one-renderer-many-canvases pattern.

This component owns the DOM, the triggers, accessibility, the motion preference, and the fallback; it never imports three. The engine is loaded with a dynamic import in an effect, so three stays out of the server bundle and out of pages without a sheet. The content is always in the accessibility tree; the stage and its canvas are aria-hidden. Keyboard focus inside the content holds the sheet open over every trigger, a host's `progress`, and the scroll scrub, so a focused link is never on a crumpled ball. Under Reduced the sheet lies flat and its print and content fade in; under Off it is simply open. Without WebGL the CSS still sheet stands in and the reveal is that same fade. */

export type CrumpleTrigger = "hover" | "click" | "in-view" | "scroll";
export type CrumpleRatio = "1:1" | "4:5" | "3:4" | "a4" | "2:3" | "4:3" | "3:2";

export type CrumpledPaperRevealProps = {
  /* The sheet's content: real DOM, painted onto the paper while it moves and live once it lies flat. */
  children?: ReactNode;
  /* Accessible name of the sheet, used by the group and the toggle ("Note from a co-author"). */
  label?: string;
  /* A print on the sheet: the whole sheet inside `inset` when there is no other content, otherwise a block at the top at `aspect` (width over height, 1.5 by default) with the content below it. `focus` is the point of the image kept in view when it is cropped, 0 to 1 on each axis. */
  image?: { src: string; alt: string; focus?: readonly [number, number]; aspect?: number };
  /* Paper margin around the print, in pixels. */
  inset?: number;
  trigger?: CrumpleTrigger;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /* 0 crumpled to 1 flat; when set, it overrides the trigger and `open`. */
  progress?: number;
  /* In view: crumple again unseen once fully out of view, so it plays again on return. */
  replay?: boolean;
  /* Scroll: `through` lies flat in the middle of the scroller and crumples toward both edges; `in` opens on the way in and stays flat. */
  scrub?: "through" | "in";
  /* Click: a click on the open paper, the corner button, or Escape crumples it again; without it the sheet stays open and the press hands focus to the content. */
  toggle?: boolean;
  /* `overlay` keeps the moving paper blank (only the print rides on it) and fades the content in once flat, for content the painter cannot draw. */
  face?: "paint" | "overlay";
  paper?: "ivory" | "page" | "kraft";
  ruling?: "none" | "lines" | "grid" | "dots";
  /* Letter folds made before the crumple. */
  fold?: "none" | "half" | "thirds";
  /* Crease memory once flat, 0 (smooth) to 1. */
  creases?: number;
  finish?: "matte" | "satin" | "gloss";
  /* Strength of the cursor lamp, 0 to 1. */
  light?: number;
  /* The ball's size, 0.6 to 1.6 of its natural size. */
  ballSize?: number;
  /* Which crumple, 1 to 12. */
  shape?: number;
  /* Used when the host sets no height. */
  ratio?: CrumpleRatio;
  corner?: "paper" | "card";
  shadow?: boolean;
  /* Milliseconds for the unfold; closing takes about two thirds of it. */
  duration?: number;
  disabled?: boolean;
  onUnfold?: () => void;
  onCrumple?: () => void;
  className?: string;
};

/* Sheets opened by a tap on a touch screen: opening one closes the others. */
const tapped = new Map<string, () => void>();

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
const wrapShape = (value: number) => ((((Math.round(Number.isFinite(value) ? value : 1) - 1) % 12) + 12) % 12) + 1;
const interactiveSelector = "a, button, input, textarea, select, label, summary, [role='button'], [role='link'], [contenteditable='true'], [tabindex]:not([tabindex='-1'])";
const focusVisible = (target: EventTarget | null) => {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return true;
  }
};

/* A sheet of paper that opens from a crumpled ball. The engine reads every --crumple-* color here at runtime, so each is a mix of the palette's own tokens and a sheet follows both themes; mode tweaks key on data-mode. The engine writes data-state (closed, opening, open, closing), data-live (a WebGL frame is on the canvas), data-busy (the ball is being solved), data-fallback (no WebGL), and --crumple-bleed; React writes data-start for the first paint, before the engine loads. */
/* Papers. Every paper stays paper-colored in every mode (a light sheet on a dark desk): ivory and kraft are tinted, and page is the site's printed page (--paper and --paper-ink), white in both themes like a compiled page. */
/* The dark palette's hues are light, so on the light papers they barely show: the rules lean on the ink, which keeps them about as strong as on the light palette. */
/* Shapes. A host that gives the sheet a height overrides the ratio. --crumple-aspect (width over height) sizes the placeholder ball from the container's width. */
/* Hover sheets take focus; the ring sits around the sheet's box. */
/* The stage overhangs the sheet by --crumple-bleed so the ball's shadow and flaps lifted toward the reader are never cut. */
/* The still sheet: the fallback without WebGL, and the first paint of a sheet that starts flat. Paper, ruling, letter folds, the corner, and a drop shadow cast along the site's light. It hides once a WebGL frame has faded in. */
/* The placeholder ball while the crumple is being solved (Full motion only): a paper-colored disc with soft shading, about 45% of the long side across. */
/* The content: real DOM over the sheet, always in the accessibility tree. Under Full it is hidden while the sheet is a ball or moving (the engine paints it onto the paper then) and fades in once the sheet lies flat. Ink multiplies into the paper, so it takes the paper's lighting. */
/* The face takes focus when it is what a press revealed (a click sheet without a corner button). Its ring is drawn on the sheet, because the face's blend mode would multiply a ring of its own into the page. */
/* Click sheets: a full-box button while crumpled (its ring around the sheet), and a corner button to crumple again once open, shown on hover, on focus within, and always where nothing hovers. */
/* Focus handed over from the cover while the paper still unfolds stays visible. */
/* High contrast and print: no picture, the content flat in system colors. */
export function CrumpledPaperReveal({
  children,
  label,
  image,
  inset = 0,
  trigger = "hover",
  open,
  defaultOpen = false,
  onOpenChange,
  progress,
  replay = true,
  scrub = "through",
  toggle = true,
  face = "paint",
  paper = "ivory",
  ruling = "none",
  fold = "none",
  creases = 0.55,
  finish = "matte",
  light = 0.5,
  ballSize = 1,
  shape = 1,
  ratio = "3:4",
  corner = "paper",
  shadow = true,
  duration,
  disabled = false,
  onUnfold,
  onCrumple,
  className,
}: CrumpledPaperRevealProps) {
  /* The site's motion level (full, reduced, or off), from <html data-motion>. */
  const { level: motion } = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLButtonElement>(null);
  const cornerRef = useRef<HTMLButtonElement>(null);
  const handleRef = useRef<SheetHandle | null>(null);
  const faceId = useId();
  const [inner, setInner] = useState(defaultOpen);
  const [held, setHeld] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [start] = useState(() => ((open ?? defaultOpen) ? "open" : "closed"));
  const timers = useRef({ hover: 0 });
  const handoff = useRef<"cover" | "corner" | "face" | "root" | null>(null);
  /* True while focus is handed back to the root, so that focus does not open the sheet it just closed. */
  const quiet = useRef(false);
  const pressed = useRef<{ x: number; y: number; type: string } | null>(null);

  const controlled = open !== undefined;
  const requested = controlled ? open : inner;
  const off = motion === "off";
  const progressValue = progress === undefined || off ? null : clamp(progress, 0, 1);
  const driven = progressValue !== null;
  const scrollLive = trigger === "scroll" && motion === "full" && !fallback && !driven;
  /* Focus inside the content holds the sheet open over a host's progress and over the scroll position, so a focused link never sits on a crumpled ball. */
  const engineProgress = held ? null : progressValue;
  const scrubbing = scrollLive && !held;
  const viewTrigger = !off && !driven && (trigger === "in-view" || (trigger === "scroll" && !scrollLive));
  const viewReplay = trigger === "in-view" && replay;
  const target = off || requested || held;
  const name = label ?? "sheet";
  const focusable = trigger === "hover" && !off && !disabled && !driven;
  const creasesValue = clamp(creases, 0, 1);
  const lightValue = clamp(light, 0, 1);
  const ballValue = clamp(ballSize, 0.6, 1.6);
  const shapeValue = wrapShape(shape);
  const insetValue = Math.max(0, Number.isFinite(inset) ? inset : 0);
  const focusX = clamp(image?.focus?.[0] ?? 0.5, 0, 1);
  const focusY = clamp(image?.focus?.[1] ?? 0.5, 0, 1);
  const hasContent = Children.toArray(children).length > 0;

  const request = (next: boolean) => {
    if (disabled || off || driven) return;
    if (!controlled) setInner(next);
    if (!next) tapped.delete(faceId);
    onOpenChange?.(next);
  };

  const sheetOptions: SheetOptions = {
    motion,
    paper,
    ruling,
    fold,
    creases: creasesValue,
    finish,
    light: lightValue,
    ballSize: ballValue,
    shape: shapeValue,
    shadow,
    face,
    image: image ? { src: image.src, focus: [focusX, focusY] } : null,
  };

  /* The values effects and engine callbacks read, current as of the last render. */
  const latest = useRef({ request, target, held, options: sheetOptions, progress: engineProgress, scrub: scrubbing ? scrub : null, onUnfold, onCrumple });
  useLayoutEffect(() => {
    latest.current = { request, target, held, options: sheetOptions, progress: engineProgress, scrub: scrubbing ? scrub : null, onUnfold, onCrumple };
  });

  /* The engine: loaded on the client only, attached once, disposed on unmount. */
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const sheetFace = faceRef.current;
    if (!root || !canvas || !sheetFace) return;
    let alive = true;
    import("@/lib/motion/crumple/engine").then(
      ({ attachSheet }) => {
        if (!alive) return;
        const current = latest.current;
        const handle = attachSheet(root, canvas, sheetFace, current.options, current.target, {
          onSettle: (isOpen) => (isOpen ? latest.current.onUnfold?.() : latest.current.onCrumple?.()),
          onFallback: () => {
            if (alive) setFallback(true);
          },
        });
        if (!handle) {
          setFallback(true);
          return;
        }
        handleRef.current = handle;
        if (current.progress !== null) handle.setProgress(current.progress);
        if (current.scrub) handle.setScroll(current.scrub);
      },
      (error: unknown) => {
        console.warn("CrumpledPaperReveal: the renderer did not load, showing the still sheet.", error);
        if (alive) setFallback(true);
      },
    );
    return () => {
      alive = false;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  /* A change of motion preference lands the sheet where it is going at once rather than animating there. */
  const lastMotion = useRef(motion);
  useEffect(() => {
    const changed = lastMotion.current !== motion;
    lastMotion.current = motion;
    const handle = handleRef.current;
    if (!handle) return;
    handle.setOptions(latest.current.options);
    if (changed) handle.setTarget(latest.current.target, true);
  }, [motion, paper, ruling, fold, creasesValue, finish, lightValue, ballValue, shapeValue, shadow, face, image?.src, focusX, focusY, ratio, corner, insetValue, hasContent]);

  useEffect(() => {
    handleRef.current?.setTarget(target);
  }, [target]);

  useEffect(() => {
    handleRef.current?.setProgress(engineProgress);
  }, [engineProgress]);

  useEffect(() => {
    handleRef.current?.setScroll(scrubbing ? scrub : null);
  }, [scrubbing, scrub]);

  /* Without WebGL the component drives the phases itself, and the CSS fades the content in and out. */
  useEffect(() => {
    const root = rootRef.current;
    if (!fallback || !root) return;
    handleRef.current?.dispose();
    handleRef.current = null;
    root.dataset.fallback = "";
    const isOpen = engineProgress !== null ? engineProgress >= 0.5 : target;
    const previous = root.dataset.state;
    const next = isOpen ? "open" : "closed";
    root.dataset.state = next;
    if (!previous || previous === next) return;
    const timer = window.setTimeout(() => (isOpen ? latest.current.onUnfold?.() : latest.current.onCrumple?.()), readMs(root, "--motion-fade-duration", 200));
    return () => window.clearTimeout(timer);
  }, [fallback, target, engineProgress]);

  /* In view (and the scroll trigger where it cannot scrub): open once enough of the sheet is visible, measured against what its scroller can show, so a sheet taller than its scroller still opens; with replay, crumple again unseen once fully out of view. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !viewTrigger || disabled) return;
    const scroller = scrollParent(root);
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(timer);
        const room = Math.min(entry.boundingClientRect.height, entry.rootBounds?.height ?? Infinity, scroller?.clientHeight || Infinity);
        const visible = entry.intersectionRect.height / Math.max(1, room);
        if (entry.isIntersecting && visible >= 0.4) timer = window.setTimeout(() => latest.current.request(true), readMs(root, "--crumple-view-delay", 120));
        else if (!entry.isIntersecting && viewReplay && !latest.current.held) {
          handleRef.current?.setTarget(false, true);
          latest.current.request(false);
        }
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.6] },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [viewTrigger, viewReplay, disabled, motion]);

  /* Timers end with the motion preference and on unmount. */
  useEffect(() => {
    const store = timers.current;
    return () => window.clearTimeout(store.hover);
  }, [motion]);
  useEffect(() => () => void tapped.delete(faceId), [faceId]);

  /* Focus follows the toggle that replaced the one it was on: the corner button, or the revealed content when there is none, and back to the cover or the sheet itself. */
  useEffect(() => {
    const next = handoff.current;
    handoff.current = null;
    if (next === "corner") cornerRef.current?.focus();
    if (next === "cover") coverRef.current?.focus();
    if (next === "face") faceRef.current?.focus();
    if (next === "root") {
      quiet.current = true;
      rootRef.current?.focus();
      quiet.current = false;
    }
  }, [requested, target]);

  const setAffordance = (hover: boolean, press: boolean) => handleRef.current?.setAffordance(hover && !disabled, press && !disabled);

  const onPointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (trigger !== "hover" || event.pointerType === "touch") return;
    window.clearTimeout(timers.current.hover);
    request(true);
  };
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (trigger !== "hover" || event.pointerType === "touch") return;
    const root = rootRef.current;
    window.clearTimeout(timers.current.hover);
    timers.current.hover = window.setTimeout(() => latest.current.request(false), root ? readMs(root, "--crumple-hover-out-delay", 220) : 220);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pressed.current = { x: event.clientX, y: event.clientY, type: event.pointerType };
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || off || driven) return;
    const sheetFace = faceRef.current;
    const hit = event.target instanceof Element ? event.target.closest(interactiveSelector) : null;
    const onContent = !!hit && !!sheetFace?.contains(hit);
    const press = pressed.current;
    const dragged = !!press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4;
    const selection = window.getSelection();
    const selecting = !!selection && !selection.isCollapsed && !!sheetFace?.contains(selection.anchorNode);
    /* Hover sheets on touch screens: a tap toggles, and opening one closes any other tapped sheet. */
    if (trigger === "hover" && (press?.type === "touch" || !canHover())) {
      if ((onContent && target) || dragged || selecting) return;
      const next = !requested;
      if (next) {
        for (const [key, close] of tapped) if (key !== faceId) close();
        tapped.set(faceId, () => latest.current.request(false));
      }
      request(next);
      return;
    }
    /* Click sheets: a click on the open paper (not on its links or fields, not after selecting text or dragging) crumples it again. */
    if (trigger === "click" && requested && toggle && sheetFace?.contains(event.target as Node) && !onContent && !dragged && !selecting) {
      setHeld(false);
      request(false);
    }
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (off || disabled || quiet.current) return;
    const inFace = !!faceRef.current?.contains(event.target as Node);
    if (((trigger === "hover" && !driven) || inFace) && focusVisible(event.target)) setHeld(true);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) {
      if (trigger !== "hover" && !faceRef.current?.contains(next)) setHeld(false);
      return;
    }
    setHeld(false);
  };

  /* Escape crumples a click sheet that can crumple again (focus goes to the cover) and a hover sheet (focus inside the content goes back to the sheet), and is left alone otherwise, so a dialog around the sheet still gets it. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !target || disabled || off || driven) return;
    const clickable = trigger === "click" && requested && toggle;
    if (!clickable && trigger !== "hover") return;
    event.preventDefault();
    event.stopPropagation();
    window.clearTimeout(timers.current.hover);
    handoff.current = clickable ? "cover" : faceRef.current?.contains(document.activeElement) ? "root" : null;
    setHeld(false);
    if (requested) request(false);
  };

  const style = {
    "--crumple-ball-size": ballValue,
    "--crumple-inset": `${insetValue}px`,
    ...(image ? { "--crumple-image": `url(${JSON.stringify(image.src)})`, "--crumple-focus": `${focusX * 100}% ${focusY * 100}%`, "--crumple-print-ratio": clamp(image.aspect ?? 1.5, 0.2, 5) } : {}),
    ...(duration !== undefined && motion === "full" && duration > 0 ? { "--crumple-open-duration": `${Math.round(duration)}ms`, "--crumple-close-duration": `${Math.round(duration * 0.63)}ms` } : {}),
  } as CSSProperties;

  const showCover = trigger === "click" && !off && !driven && !target;
  const showCorner = trigger === "click" && !off && !driven && requested && toggle;

  return (
    <div
      ref={rootRef}
      className={cn("crumple relative w-full min-w-0 @container/crumple group/crumple [--crumple-open-duration:1500ms] [--crumple-open-ease:cubic-bezier(0.42,0,0.18,1)] [--crumple-close-duration:950ms] [--crumple-close-ease:cubic-bezier(0.6,0.02,0.8,0.35)] [--crumple-view-delay:120ms] [--crumple-hover-out-delay:220ms] [--crumple-line:1.75rem] [--crumple-grid:20px] [--crumple-pad:clamp(14px,8cqi,44px)] [--crumple-radius:2px] [--crumple-aspect:0.75] [--crumple-back:color-mix(in_oklab,var(--crumple-paper)_94%,var(--crumple-ink))] [--crumple-rule:color-mix(in_oklab,var(--hue-blue)_30%,var(--crumple-paper))] [--crumple-rule-strong:color-mix(in_oklab,var(--hue-teal)_40%,var(--crumple-paper))] [--crumple-margin:color-mix(in_oklab,var(--hue-red)_45%,var(--crumple-paper))] [--crumple-dot:color-mix(in_oklab,var(--crumple-ink)_22%,var(--crumple-paper))] [--crumple-fold:color-mix(in_oklab,var(--crumple-ink)_9%,var(--crumple-paper))] [--crumple-shadow:color-mix(in_oklab,var(--foreground)_38%,transparent)] [--crumple-key:color-mix(in_oklab,var(--surface)_94%,var(--hue-amber))] [--crumple-lamp:color-mix(in_oklab,var(--crumple-key)_88%,var(--accent))] [--crumple-sky:var(--surface)] [--crumple-bounce:var(--crumple-ground,var(--background))] relative isolate aspect-[3/4] rounded-(--crumple-radius) outline-none [:root[data-mode=dark]_&]:[--crumple-shadow:color-mix(in_oklab,var(--background)_85%,transparent)] [:root[data-mode=dark]_&]:[--crumple-key:color-mix(in_oklab,var(--foreground)_94%,var(--hue-amber))] [:root[data-mode=dark]_&]:[--crumple-sky:color-mix(in_oklab,var(--foreground)_60%,var(--background))] data-[paper=ivory]:[--crumple-paper:color-mix(in_oklab,var(--surface)_92%,var(--hue-amber))] data-[paper=ivory]:[--crumple-ink:color-mix(in_oklab,var(--foreground)_90%,var(--hue-blue))] [:root[data-mode=dark]_&]:data-[paper=ivory]:[--crumple-paper:color-mix(in_oklab,color-mix(in_oklab,var(--foreground)_90%,var(--hue-amber))_86%,var(--background))] [:root[data-mode=dark]_&]:data-[paper=ivory]:[--crumple-ink:color-mix(in_oklab,var(--background)_86%,var(--hue-blue))] data-[paper=kraft]:[--crumple-paper:color-mix(in_oklab,var(--hue-amber)_40%,var(--surface))] data-[paper=kraft]:[--crumple-ink:color-mix(in_oklab,var(--foreground)_92%,var(--hue-orange))] [:root[data-mode=dark]_&]:data-[paper=kraft]:[--crumple-paper:color-mix(in_oklab,color-mix(in_oklab,color-mix(in_oklab,var(--hue-amber)_75%,var(--hue-orange))_60%,var(--foreground))_75%,var(--background))] [:root[data-mode=dark]_&]:data-[paper=kraft]:[--crumple-ink:color-mix(in_oklab,var(--background)_90%,var(--hue-orange))] data-[paper=page]:[--crumple-paper:var(--paper)] data-[paper=page]:[--crumple-ink:var(--paper-ink)] [:root[data-mode=dark]_&]:data-[paper=page]:[--crumple-rule:color-mix(in_oklab,color-mix(in_oklab,var(--hue-blue)_50%,var(--crumple-ink))_35%,var(--crumple-paper))] [:root[data-mode=dark]_&]:data-[paper=page]:[--crumple-rule-strong:color-mix(in_oklab,color-mix(in_oklab,var(--hue-teal)_50%,var(--crumple-ink))_45%,var(--crumple-paper))] [:root[data-mode=dark]_&]:data-[paper=page]:[--crumple-margin:color-mix(in_oklab,color-mix(in_oklab,var(--hue-red)_60%,var(--crumple-ink))_45%,var(--crumple-paper))] [:root[data-mode=dark]_&]:data-[paper=ivory]:[--crumple-rule:color-mix(in_oklab,color-mix(in_oklab,var(--hue-blue)_50%,var(--crumple-ink))_35%,var(--crumple-paper))] [:root[data-mode=dark]_&]:data-[paper=ivory]:[--crumple-rule-strong:color-mix(in_oklab,color-mix(in_oklab,var(--hue-teal)_50%,var(--crumple-ink))_45%,var(--crumple-paper))] [:root[data-mode=dark]_&]:data-[paper=ivory]:[--crumple-margin:color-mix(in_oklab,color-mix(in_oklab,var(--hue-red)_60%,var(--crumple-ink))_45%,var(--crumple-paper))] [:root[data-mode=dark]_&]:data-[paper=kraft]:[--crumple-rule:color-mix(in_oklab,color-mix(in_oklab,var(--hue-blue)_50%,var(--crumple-ink))_35%,var(--crumple-paper))] [:root[data-mode=dark]_&]:data-[paper=kraft]:[--crumple-rule-strong:color-mix(in_oklab,color-mix(in_oklab,var(--hue-teal)_50%,var(--crumple-ink))_45%,var(--crumple-paper))] [:root[data-mode=dark]_&]:data-[paper=kraft]:[--crumple-margin:color-mix(in_oklab,color-mix(in_oklab,var(--hue-red)_60%,var(--crumple-ink))_45%,var(--crumple-paper))] data-[ratio=1:1]:aspect-[1] data-[ratio=1:1]:[--crumple-aspect:1] data-[ratio=4:5]:aspect-[4/5] data-[ratio=4:5]:[--crumple-aspect:0.8] data-[ratio=3:4]:aspect-[3/4] data-[ratio=3:4]:[--crumple-aspect:0.75] data-[ratio=a4]:aspect-[210/297] data-[ratio=a4]:[--crumple-aspect:0.7071] data-[ratio=2:3]:aspect-[2/3] data-[ratio=2:3]:[--crumple-aspect:0.6667] data-[ratio=4:3]:aspect-[4/3] data-[ratio=4:3]:[--crumple-aspect:1.3333] data-[ratio=3:2]:aspect-[3/2] data-[ratio=3:2]:[--crumple-aspect:1.5] data-[corner=card]:[--crumple-radius:var(--radius-card)] motion-reduced:[--crumple-open-duration:var(--motion-fade-duration)] motion-reduced:[--crumple-close-duration:var(--motion-fade-duration)] focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-4 [&:has(>_.crumple-face:focus-visible)]:outline-2 [&:has(>_.crumple-face:focus-visible)]:outline-focus [&:has(>_.crumple-face:focus-visible)]:outline-offset-4", className)}
      role={label || focusable ? "group" : undefined}
      aria-label={label}
      tabIndex={focusable ? 0 : undefined}
      data-start={start}
      data-paper={paper}
      data-ruling={ruling}
      data-fold={fold}
      data-ratio={ratio}
      data-corner={corner}
      data-trigger={trigger}
      data-disabled={disabled || undefined}
      style={style}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <div className="absolute inset-[calc(var(--crumple-bleed,0px)_*_-1)] z-0 pointer-events-none [@media(forced-colors:_active)]:hidden print:hidden" aria-hidden="true">
        <div className="crumple-still absolute inset-[var(--crumple-bleed,0px)] overflow-hidden rounded-(--crumple-radius) bg-(--crumple-paper) bg-[image:var(--crumple-still-folds,none)] [background-repeat:no-repeat] shadow-(--lit-drop) group-data-live/crumple:group-[:not([data-fallback])]/crumple:opacity-0 group-data-live/crumple:group-[:not([data-fallback])]/crumple:[transition:opacity_0s_linear_var(--motion-fade-duration)] before:content-[''] before:absolute before:inset-0 after:content-[''] after:absolute after:inset-0 group-data-[ruling=lines]/crumple:before:[inset:var(--crumple-pad)_0_0_0] group-data-[ruling=lines]/crumple:before:bg-[linear-gradient(to_bottom,transparent_calc(76%_-_0.5px),var(--crumple-rule)_calc(76%_-_0.5px),var(--crumple-rule)_calc(76%_+_0.5px),transparent_calc(76%_+_0.5px))] group-data-[ruling=lines]/crumple:before:[background-size:100%_var(--crumple-line)] group-data-[ruling=lines]/crumple:after:start-[calc(12%_-_0.5px)] group-data-[ruling=lines]/crumple:after:w-px group-data-[ruling=lines]/crumple:after:bg-(--crumple-margin) group-data-[ruling=grid]/crumple:before:bg-[linear-gradient(to_right,var(--crumple-rule-strong)_1px,transparent_1px),linear-gradient(to_bottom,var(--crumple-rule-strong)_1px,transparent_1px),linear-gradient(to_right,color-mix(in_oklab,var(--crumple-rule)_80%,var(--crumple-paper))_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--crumple-rule)_80%,var(--crumple-paper))_1px,transparent_1px)] group-data-[ruling=grid]/crumple:before:[background-size:calc(var(--crumple-grid)_*_5)_calc(var(--crumple-grid)_*_5),calc(var(--crumple-grid)_*_5)_calc(var(--crumple-grid)_*_5),var(--crumple-grid)_var(--crumple-grid),var(--crumple-grid)_var(--crumple-grid)] group-data-[ruling=grid]/crumple:before:[background-position:center] group-data-[ruling=dots]/crumple:before:bg-[radial-gradient(circle,var(--crumple-dot)_1.1px,transparent_1.6px)] group-data-[ruling=dots]/crumple:before:[background-size:var(--crumple-grid)_var(--crumple-grid)] group-data-[ruling=dots]/crumple:before:[background-position:center] group-data-[fold=half]/crumple:[--crumple-still-folds:linear-gradient(to_bottom,transparent_calc(50%_-_6px),var(--crumple-fold)_calc(50%_-_0.5px),color-mix(in_oklab,var(--crumple-fold)_60%,var(--crumple-ink))_50%,transparent_calc(50%_+_3px))] group-data-[fold=thirds]/crumple:[--crumple-still-folds:linear-gradient(to_bottom,transparent_calc(33.333%_-_6px),var(--crumple-fold)_calc(33.333%_-_0.5px),color-mix(in_oklab,var(--crumple-fold)_60%,var(--crumple-ink))_33.333%,transparent_calc(33.333%_+_3px)),linear-gradient(to_bottom,transparent_calc(66.667%_-_6px),var(--crumple-fold)_calc(66.667%_-_0.5px),color-mix(in_oklab,var(--crumple-fold)_60%,var(--crumple-ink))_66.667%,transparent_calc(66.667%_+_3px))] motion-full:group-data-[start=closed]/crumple:group-[:not([data-state])]/crumple:group-[:not([data-fallback])]/crumple:opacity-0 motion-full:group-data-[start=closed]/crumple:group-[:not([data-state])]/crumple:group-[:not([data-fallback])]/crumple:[transition:none] motion-full:group-data-busy/crumple:group-data-state/crumple:group-[:not([data-state=open])]/crumple:group-[:not([data-live])]/crumple:group-[:not([data-fallback])]/crumple:opacity-0 motion-full:group-data-busy/crumple:group-data-state/crumple:group-[:not([data-state=open])]/crumple:group-[:not([data-live])]/crumple:group-[:not([data-fallback])]/crumple:[transition:none]" />
        <div className="absolute top-1/2 left-1/2 w-[calc(45cqi_/_min(1,var(--crumple-aspect))_*_var(--crumple-ball-size,1))] aspect-[1] [translate:-50%_-50%] rounded-[50%] bg-[radial-gradient(circle_at_36%_30%,color-mix(in_oklab,var(--crumple-paper)_70%,var(--crumple-key)),var(--crumple-paper)_46%,color-mix(in_oklab,var(--crumple-paper)_80%,var(--crumple-ink))_100%)] shadow-(--lit-drop) opacity-0 [transition:opacity_0s_linear_var(--motion-fade-duration)] motion-full:group-data-[start=closed]/crumple:group-[:not([data-state])]/crumple:group-[:not([data-fallback])]/crumple:opacity-100 motion-full:group-data-[start=closed]/crumple:group-[:not([data-state])]/crumple:group-[:not([data-fallback])]/crumple:[transition:none] motion-full:group-data-[start=closed]/crumple:group-[:not([data-state])]/crumple:group-[:not([data-fallback])]/crumple:[animation:crumple-breathe_1.8s_var(--motion-ease)_infinite] motion-full:group-data-busy/crumple:group-data-state/crumple:group-[:not([data-state=open])]/crumple:group-[:not([data-live])]/crumple:group-[:not([data-fallback])]/crumple:opacity-100 motion-full:group-data-busy/crumple:group-data-state/crumple:group-[:not([data-state=open])]/crumple:group-[:not([data-live])]/crumple:group-[:not([data-fallback])]/crumple:[transition:none] motion-full:group-data-busy/crumple:group-data-state/crumple:group-[:not([data-state=open])]/crumple:group-[:not([data-live])]/crumple:group-[:not([data-fallback])]/crumple:[animation:crumple-breathe_1.8s_var(--motion-ease)_infinite]" />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-0 transition-[opacity] duration-(--motion-fade-duration) ease-(--motion-ease) group-data-live/crumple:group-[:not([data-fallback])]/crumple:opacity-100" />
      </div>
      <div ref={faceRef} id={faceId} className="crumple-face [&&&&]:absolute [&&&&]:inset-0 [&&&&]:z-[1] [&&&&]:overflow-hidden [&&&&]:p-(--crumple-pad) [&&&&]:rounded-(--crumple-radius) [&&&&]:text-(--crumple-ink) [&&&&]:[mix-blend-mode:multiply] [&&&&]:wrap-break-word [&&&&]:opacity-0 [&&&&]:pointer-events-none group-[:not([data-ruling=none])]/crumple:leading-[var(--crumple-line)] focus:outline-none [&&&]:[.crumple[data-state=open]_&]:opacity-100 [&&&]:[.crumple[data-state=open]_&]:pointer-events-auto [&&&]:[.crumple[data-state=open]_&]:transition-[opacity] [&&&]:[.crumple[data-state=open]_&]:duration-(--motion-fade-duration) [&&&]:[.crumple[data-state=open]_&]:ease-(--motion-ease) [&&&&]:[.crumple:not([data-state])[data-start=open]_&]:opacity-100 [&&&&]:[.crumple:not([data-state])[data-start=open]_&]:pointer-events-auto [&&&&]:[.crumple:not([data-state])[data-start=open]_&]:transition-[opacity] [&&&&]:[.crumple:not([data-state])[data-start=open]_&]:duration-(--motion-fade-duration) [&&&&]:[.crumple:not([data-state])[data-start=open]_&]:ease-(--motion-ease) [&&&&]:[:root[data-motion=off]_.crumple_&]:opacity-100 [&&&&]:[:root[data-motion=off]_.crumple_&]:pointer-events-auto [&&&&]:[:root[data-motion=off]_.crumple_&]:transition-[opacity] [&&&&]:[:root[data-motion=off]_.crumple_&]:duration-(--motion-fade-duration) [&&&&]:[:root[data-motion=off]_.crumple_&]:ease-(--motion-ease) [&&&&]:[:root[data-motion=reduced]_.crumple_&]:transition-[opacity] [&&&&]:[:root[data-motion=reduced]_.crumple_&]:duration-(--motion-fade-duration) [&&&&]:[:root[data-motion=reduced]_.crumple_&]:ease-(--motion-ease) [&&&&]:[.crumple[data-fallback]_&]:transition-[opacity] [&&&&]:[.crumple[data-fallback]_&]:duration-(--motion-fade-duration) [&&&&]:[.crumple[data-fallback]_&]:ease-(--motion-ease) [:root[data-motion=reduced]_.crumple[data-state=opening]_&]:opacity-100 [.crumple[data-fallback][data-state=opening]_&]:opacity-100 [@media(forced-colors:_active)]:[&&&&]:border [@media(forced-colors:_active)]:[&&&&]:border-[CanvasText] [@media(forced-colors:_active)]:[&&&&]:bg-[Canvas] [@media(forced-colors:_active)]:[&&&&]:text-[CanvasText] [@media(forced-colors:_active)]:[&&&&]:[mix-blend-mode:normal] [@media(forced-colors:_active)]:[&&&&]:opacity-100 [@media(forced-colors:_active)]:[&&&&]:pointer-events-auto print:[&&&&]:border print:[&&&&]:border-current print:[&&&&]:[mix-blend-mode:normal] print:[&&&&]:opacity-100" tabIndex={trigger === "click" && !toggle ? -1 : undefined} data-print={image ? (hasContent ? "top" : "full") : undefined}>
        {image ? <span role="img" aria-label={image.alt} className="crumple-print-label block [background-position:var(--crumple-focus,50%_50%)] [background-size:cover] [background-repeat:no-repeat] [.crumple-face[data-print=full]>&]:absolute [.crumple-face[data-print=full]>&]:inset-[var(--crumple-inset,0px)] [.crumple-face[data-print=top]>&]:aspect-[var(--crumple-print-ratio,1.5)] [.crumple-face[data-print=top]>&]:m-[calc(var(--crumple-inset,0px)_-_var(--crumple-pad))] [.crumple-face[data-print=top]>&]:mb-[calc(var(--crumple-pad)_*_0.6)] group-data-fallback/crumple:bg-[image:var(--crumple-image,none)] group-[:not([data-live])]/crumple:bg-[image:var(--crumple-image,none)]" data-crumple-skip="" /> : null}
        {children}
      </div>
      {showCover ? (
        <button
          ref={coverRef}
          type="button"
          className="absolute inset-0 z-[2] p-0 border-0 rounded-(--crumple-radius) bg-transparent cursor-pointer [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-4 disabled:cursor-default print:hidden"
          aria-expanded={false}
          aria-controls={faceId}
          aria-label={`Unfold ${name}`}
          disabled={disabled}
          onClick={(event) => {
            handoff.current = document.activeElement === event.currentTarget ? (toggle ? "corner" : "face") : null;
            setAffordance(false, false);
            request(true);
          }}
          onPointerEnter={(event) => event.pointerType !== "touch" && setAffordance(true, false)}
          onPointerLeave={() => setAffordance(false, false)}
          onPointerDown={() => setAffordance(true, true)}
          onPointerUp={() => setAffordance(true, false)}
        />
      ) : null}
      {showCorner ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={cornerRef}
              variant="outline"
              size="icon"
              aria-label={`Crumple ${name}`}
              className="absolute top-2 end-2 z-[2] opacity-0 transition-[opacity] duration-(--motion-fade-duration) ease-(--motion-ease) group-hover/crumple:opacity-100! group-focus-within/crumple:opacity-100! [@media(hover:_none)]:opacity-100 group-data-state/crumple:group-[:not([data-state=open])]/crumple:opacity-0! group-data-state/crumple:group-[:not([data-state=open])]/crumple:pointer-events-none focus-visible:opacity-100 group-data-state/crumple:focus-visible:opacity-100! print:hidden"
              aria-expanded
              aria-controls={faceId}
              disabled={disabled}
              onClick={(event) => {
                handoff.current = document.activeElement === event.currentTarget ? "cover" : null;
                setHeld(false);
                request(false);
              }}
            >
              <Shrink aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{`Crumple ${name}`}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
