"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft, ArrowUp, Bold, Braces, Check, ChevronDown, ChevronRight, Code, Download, Eye, History, Italic, List, Loader2, Mic, Play, Send, Settings, Sigma, Underline, UserPlus, X, ZoomIn, ZoomOut } from "@/components/icons";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";
import { MessageBody, PersonAvatar, type Person } from "@/components/editor/review/parts";
import { ThreadView } from "@/components/editor/review/ThreadView";
import { Avatar } from "@/components/people/Avatar";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { TexTokens } from "@/components/ui/tex-code";
import { RelativeTime } from "@/components/ui/time";
import { useMotion } from "@/hooks/useMotion";
import type { CommentThread } from "@/lib/api/collab";
import { tokenizeTex, tokenizeTexLine } from "@/lib/tex-highlight";
import { cn } from "@/lib/utils";
import { modelName } from "@/lib/ai/model-name";
import { HERO_PAGES } from "./hero-pages";

/*
 * The hero's picture of the product: the editor in its Default layout (Files, Review, and Chat as tabs in the sidebar with Contents under them; the editor with Axya under it; the PDF in a column of its own), playing one short scene on a loop.
 *
 * You write a sentence and press Recompile, and the page shows it. Atiyah comments on the claim in it, and Review comes to the front with his thread. You ask Axya to cite it; Axya reads references.bib and proposes the change as a diff, which you accept. Recompile again, and the page has the citation and its entry in the references. Then Chat comes to the front: you tell the others, and Atiyah answers and resolves his comment.
 *
 * It is drawn with the app's own parts where they can stand alone (the Review panel's thread card, the segmented control, the buttons, the avatars, the relative times), and with the same markup and classes as the Chat panel and Axya's conversation where those are bound to a live project. The page is real: the source is scripts/hero-document/main.tex, and the three pages are that document compiled by TeX at three moments of the scene (scripts/hero-document/build.sh writes them to public/hero, named by their content, and lists them in hero-pages.ts), shown whole at the height of the PDF column, which is exactly as wide as the page. Keep the lines below the same as main.tex.
 *
 * It can be looked around while the scene plays (the inert parts also let the pointer through, so the wheel scrolls the panel under them): the sidebar's tabs (Files, Review, and Chat; Contents, References, and History) switch when pressed, and the editor, the conversation, Review, and Chat scroll. The scene goes on regardless, in whichever tab is in front: a tab the reader chose stays in front, and the scene only brings a tab forward while the reader has not chosen one. The conversation and the chat stay on their latest line unless the reader scrolls up. Nothing else answers to the pointer (the buttons and fields are inert), and it is hidden from assistive technology, which has the headline and the links above it; the tabs take no keyboard focus. Whatever arrives or leaves grows or shrinks into place and fades, and the panels behind a tab strip cross-fade, so nothing jumps. With motion reduced it shows the scene's last frame and does not move.
 */

/** main.tex, whole; the sentence written during the scene is line 19. */
const FIRST_LINE = 1;
const BEFORE = ["\\documentclass[10pt]{article}", "\\usepackage[a5paper, hmargin=14mm, top=8mm, bottom=12mm]{geometry}", "\\usepackage{amsmath, amssymb, amsthm}", "\\newtheorem{theorem}{Theorem}", "\\pagenumbering{gobble}", "\\title{Braiding Fibonacci anyons}", "\\author{Michael Atiyah \\and Henri Poincar\\'e \\and Richard Feynman}", "\\date{}", "", "\\begin{document}", "\\maketitle", "", "\\section{Introduction}", "Topological quantum computers keep qubits in", "the fusion space of anyons~\\cite{kitaev03}.", "Fibonacci anyons have one nontrivial particle,", "$\\tau$, with the fusion rule", "\\[ \\tau \\otimes \\tau = 1 \\oplus \\tau. \\]"];
const AFTER = ["", "\\begin{theorem}", "  The fusion space of $n$ copies of $\\tau$", "  has dimension $F_{n+1}$, a Fibonacci number.", "\\end{theorem}", "", "\\section{Braiding}", "Exchanging two anyons that fuse to $c$ multiplies", "the state by the phase $R^{\\tau\\tau}_c$, where", "\\[ R^{\\tau\\tau}_1 = e^{-4\\pi i/5}, \\qquad", "   R^{\\tau\\tau}_\\tau = e^{3\\pi i/5}. \\]", "Changing the order of fusion is the $F$-move, and", "the two satisfy the pentagon and hexagon", "equations~\\cite{kitaev06, wang10}. For how this", "becomes a computer, see the survey~\\cite{nayak08}.", "", "\\bibliographystyle{plain}", "{\\small\\bibliography{references}}", "\\end{document}"];
const BEFORE_TOKENS = tokenizeTex(BEFORE.join("\n"));
const AFTER_TOKENS = tokenizeTex(AFTER.join("\n"));

const SENTENCE_START = "Their braiding alone is ";
const SENTENCE_CLAIM = "dense in $SU(2)$";
const SENTENCE = `${SENTENCE_START}${SENTENCE_CLAIM}.`;
const CITATION = "~\\cite{freedman02}";
const COMMAND = "/cite";
const PROMPT = `${COMMAND} the claim Atiyah flagged`;
const MESSAGE = "Cited Freedman, Larsen, and Wang for density. It is on page one now.";
const REPLY = "Looks right on the page. Resolving my comment.";
/** The model, named as people write it: the same formatter names models everywhere in the app. */
const MODEL = modelName("claude-opus-5-5");

/** The people in the scene: you, the reviewer who comments, and a co-author. Scientists from history, not real accounts. */
const YOU: Person = { id: 7103, name: "Richard Feynman" };
const ATIYAH: Person = { id: 7101, name: "Michael Atiyah" };
const POINCARE: Person = { id: 7102, name: "Henri Poincaré" };
const PEOPLE = [YOU, ATIYAH, POINCARE];

const FILES: { name: string; folder?: boolean; open?: boolean; inside?: boolean; main?: boolean }[] = [
  { name: "figures", folder: true, open: true },
  { name: "braid-exchange.pdf", inside: true },
  { name: "fusion-tree.tikz", inside: true },
  { name: "main.tex", main: true },
  { name: "references.bib" },
  { name: "README.md" },
];

/** The scene, in order. Each step lasts `ms`; what is on screen depends only on the step and how far through it we are. */
const SCENE = [
  { id: "write", ms: 3400 },
  { id: "compile", ms: 1900 },
  { id: "comment", ms: 2800 },
  { id: "ask", ms: 3400 },
  { id: "propose", ms: 2600 },
  { id: "accept", ms: 1500 },
  { id: "recompile", ms: 2000 },
  { id: "chat", ms: 4800 },
  { id: "rest", ms: 2400 },
] as const;

type Step = (typeof SCENE)[number]["id"];

/** How far into a compile step the page arrives: the button is pressed, TeX runs, the page changes. */
const COMPILED = 0.55;

/** A page of the hero document is A5: its width over its height. */
const PAGE_RATIO = 419.528 / 595.276;
/** The PDF column's tab strip and toolbar, above the page. */
const PDF_CHROME = 40 + 48;

const noop = () => () => {};
/** False on the server and in the first render in the browser, then true: the times are drawn only in the browser, where "now" is known. */
function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

function useScene() {
  const { animates } = useMotion();
  // The first loop starts when the page does, also when the scene stands still on its last frame. Only times drawn in the browser read it.
  const [state, setState] = useState(() => ({ index: 0, progress: 0, loop: Date.now() }));
  useEffect(() => {
    if (!animates) return;
    let loop = Date.now();
    let started = performance.now();
    let index = 0;
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - started;
      if (elapsed >= SCENE[index].ms) {
        index = (index + 1) % SCENE.length;
        started = performance.now();
        if (index === 0) loop = Date.now();
        setState({ index, progress: 0, loop });
      } else setState({ index, progress: elapsed / SCENE[index].ms, loop });
    }, 60);
    return () => window.clearInterval(timer);
  }, [animates]);
  // With motion off: the last frame, complete.
  const index = animates ? state.index : SCENE.length - 1;
  const progress = animates ? state.progress : 1;
  const order = (step: Step) => SCENE.findIndex((s) => s.id === step);
  return { at: (step: Step) => index === order(step), from: (step: Step) => index >= order(step), progress, loop: state.loop };
}

/** Something that arrives or leaves during the scene: it grows to its height and fades in, or shrinks away, so what is around it moves smoothly instead of jumping. */
function Expand({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-still:transition-none", show ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className={cn("min-h-0 overflow-hidden", className)}>{children}</div>
    </div>
  );
}

/** Layers behind one tab strip: all are drawn, the front one is shown, and changing it cross-fades. */
function Layer({ front, children, className }: { front: boolean; children: ReactNode; className?: string }) {
  return <div className={cn("absolute inset-0 flex flex-col transition-opacity duration-300 motion-still:transition-none", front ? "opacity-100" : "pointer-events-none opacity-0", className)}>{children}</div>;
}

/** A dock tab strip, as the app draws it: the front tab is lifted onto the panel and carries a line along its top. */
function Tabs({ names, front = names[0], onPick }: { names: string[]; front?: string; onPick?: (name: string) => void }) {
  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-line bg-background type-base">
      {names.map((name) =>
        onPick ? (
          // A tab the reader can press; it takes no keyboard focus, since the picture is hidden from assistive technology.
          <button key={name} type="button" tabIndex={-1} onClick={() => onPick(name)} className={cn("flex cursor-pointer items-center px-3.5 transition-colors duration-200", name === front ? "bg-panel font-medium text-foreground shadow-[inset_0_2px_0_var(--foreground)]" : "text-muted-foreground hover:text-foreground")}>
            {name}
          </button>
        ) : (
          <span key={name} className={cn("flex items-center px-3.5 transition-colors duration-200", name === front ? "bg-panel font-medium text-foreground shadow-[inset_0_2px_0_var(--foreground)]" : "text-muted-foreground")}>
            {name}
          </span>
        ),
      )}
    </div>
  );
}

/** A scrolling panel that stays on its latest line as things arrive, as the conversation and the chat do in the app, until the reader scrolls up; scrolled back to the end, it follows again. */
function useFollow<T extends HTMLElement>(ready = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let stuck = true;
    // Where the panel last put itself. Content still growing in moves the end away between that and the scroll event it causes, so only a move up from there is the reader leaving the end; reaching the end again sticks it.
    let placed = 0;
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 16) stuck = true;
      else if (el.scrollTop < placed - 2) stuck = false;
    };
    const stick = () => {
      if (!stuck) return;
      el.scrollTop = el.scrollHeight;
      placed = el.scrollTop;
    };
    // Things grow into place over a few frames, so the panel follows every change of size, not only the first.
    const observer = new ResizeObserver(stick);
    for (const child of Array.from(el.children)) observer.observe(child);
    observer.observe(el);
    stick();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
    // The panel may only be drawn once the page is in the browser (`ready`), so it is attached then.
  }, [ready]);
  return ref;
}

/** Axya's mark in the theme's ink, both drawn and one shown, so the server and the browser agree on it. */
function AxyaMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block size-4 shrink-0", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- The mark is a 16px static image. */}
      <img src="/axya/LightT.png" alt="" className="absolute inset-0 size-full object-contain dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- The mark is a 16px static image. */}
      <img src="/axya/DarkT.png" alt="" className="absolute inset-0 hidden size-full object-contain dark:block" />
    </span>
  );
}

function Line({ number, children, active, className }: { number: number; children?: ReactNode; active?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-h-6", active && "bg-surface/60", className)}>
      <span className={cn("w-11 shrink-0 pe-3 text-end tabular-nums", active ? "text-foreground" : "text-muted-foreground/60")}>{number}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{children}</span>
    </div>
  );
}

/** A version in the History panel: who saved what, and when. */
function HistoryRow({ person, what, at }: { person: Person; what: string; at: number }) {
  return (
    <div className="flex min-h-12 items-center gap-2.5 rounded-[var(--radius-item)] px-2 py-1.5">
      <PersonAvatar person={person} />
      <div className="min-w-0 flex-1">
        <p className="truncate type-base font-medium">{person.name}</p>
        <p className="truncate type-small text-muted-foreground">Changed {what}</p>
      </div>
      <RelativeTime value={at} focusable={false} style="short" className="shrink-0 self-start pt-0.5 type-small text-muted-foreground" />
    </div>
  );
}

/** One message in the project's chat, with the Chat panel's own markup: the face in its column, the name, You, and when, then the words. */
function ChatMessage({ person, at, now, children }: { person: Person; at: number; now: boolean; children: string }) {
  return (
    <div className="-mx-1.5 flex gap-2 rounded-[var(--radius)] px-1.5 py-0.5">
      <div className="w-6 shrink-0">
        <PersonAvatar person={person} className="mt-1" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex min-h-8 min-w-0 items-center gap-2">
          <span className="truncate type-base font-medium">{person.name}</span>
          {person.id === YOU.id && <span className="type-small text-muted-foreground">You</span>}
          {now && <RelativeTime value={at} focusable={false} className="shrink-0 type-small text-muted-foreground" />}
        </p>
        <MessageBody text={children} people={PEOPLE} />
      </div>
    </div>
  );
}

export function HeroPreview({ className }: { className?: string }) {
  const scene = useScene();
  const hydrated = useHydrated();
  const typedLine = FIRST_LINE + BEFORE.length;

  // The PDF column is exactly as wide as the page standing the full height of the column, so it has no margins to spare.
  const grid = useRef<HTMLDivElement>(null);
  const [pdfWidth, setPdfWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setPdfWidth(Math.round((el.clientHeight - PDF_CHROME) * PAGE_RATIO));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The tabs the reader chose, if any: they stay in front while the scene goes on behind them.
  const [pickedSide, setPickedSide] = useState<string | null>(null);
  const [bottom, setBottom] = useState("Contents");
  const conversation = useFollow<HTMLDivElement>();
  const chat = useFollow<HTMLDivElement>(hydrated);
  // The editor opens a little above the line being written, the rest of the file a scroll away.
  const code = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = code.current;
    if (el) el.scrollTop = Math.max(0, (19 - 1) * 24 + 8 - el.clientHeight * 0.45);
  }, []);

  // The scene, as what is on screen.
  const typed = scene.at("write") ? SENTENCE.slice(0, Math.round(Math.min(scene.progress * 1.3, 1) * SENTENCE.length)) : SENTENCE;
  const commented = scene.from("comment");
  const asking = scene.at("ask") && scene.progress < 0.42;
  const draft = asking ? PROMPT.slice(0, Math.round(Math.min(scene.progress / 0.36, 1) * PROMPT.length)) : "";
  const asked = scene.from("propose") || (scene.at("ask") && scene.progress >= 0.42);
  const reading = scene.at("ask") && scene.progress >= 0.5;
  const read = scene.from("propose");
  const proposed = scene.from("propose");
  const pressing = scene.at("accept") && scene.progress < 0.3;
  const cited = scene.from("accept") && !(scene.at("accept") && scene.progress < 0.3);
  // Recompile is pressed twice: after the sentence is written, and after the citation is accepted. The page changes partway through each.
  const compiling = (scene.at("compile") || scene.at("recompile")) && scene.progress < COMPILED;
  const page = scene.from("chat") || (scene.at("recompile") && scene.progress >= COMPILED) ? 3 : scene.from("comment") || (scene.at("compile") && scene.progress >= COMPILED) ? 2 : 1;
  const sceneTab = scene.from("chat") ? "Chat" : commented ? "Review" : "Files";
  const sideTab = pickedSide ?? sceneTab;
  const typingMessage = scene.at("chat") && scene.progress < 0.32;
  const chatDraft = typingMessage ? MESSAGE.slice(0, Math.round(Math.min(scene.progress / 0.28, 1) * MESSAGE.length)) : "";
  const sent = scene.from("rest") || (scene.at("chat") && scene.progress >= 0.34);
  const replied = scene.from("rest") || (scene.at("chat") && scene.progress >= 0.72);
  const resolved = scene.from("rest") || (scene.at("chat") && scene.progress >= 0.86);

  // Times, from when this loop of the scene began: Atiyah commented a moment ago, Poincaré wrote ten minutes before, and Atiyah the day before.
  const t0 = scene.loop || 0;
  const thread = useMemo<CommentThread>(() => {
    const at = new Date(t0 || 0).toISOString();
    return {
      id: 1,
      path: "main.tex",
      anchorStart: null,
      anchorEnd: null,
      quote: SENTENCE_CLAIM,
      offset: 0,
      color: null,
      resolved: false,
      resolvedAt: null,
      resolvedById: null,
      createdById: ATIYAH.id,
      createdAt: at,
      updatedAt: at,
      createdBy: ATIYAH,
      messages: [{ id: 1, threadId: 1, authorId: ATIYAH.id, content: "Cite Freedman, Larsen, and Wang for this, or sketch the proof.", createdAt: at, editedAt: null, author: ATIYAH }],
    };
  }, [t0]);
  const still = () => {};
  const stillAsync = async () => false;

  // The written line as it stands: its start, the claim (marked as a comment once Atiyah comments, until he resolves it), and its end (the full stop, with the citation before it once the change is accepted). Each part is colored as source.
  const tex = (text: string) => <TexTokens tokens={tokenizeTexLine(text).tokens} />;
  const done = typed.length === SENTENCE.length;
  const source = (
    <>
      {tex(typed.slice(0, SENTENCE_START.length))}
      <span style={{ "--comment-hue": "var(--hue-amber)" } as React.CSSProperties} className={cn("transition-[background-color,border-color] duration-300", commented && !resolved ? "border-b-2 border-[color:color-mix(in_oklch,var(--comment-hue)_60%,transparent)] bg-[color-mix(in_oklch,var(--comment-hue)_18%,transparent)]" : "border-b-2 border-transparent")}>
        {tex(typed.slice(SENTENCE_START.length, SENTENCE_START.length + SENTENCE_CLAIM.length))}
      </span>
      {cited && tex(CITATION)}
      {done && "."}
    </>
  );

  const grid3 = pdfWidth ? `20rem minmax(0,1fr) ${pdfWidth}px` : "20rem minmax(0,1fr) minmax(0,0.75fr)";
  const grid2 = pdfWidth ? `minmax(0,1fr) ${pdfWidth}px` : "minmax(0,1fr) minmax(0,0.75fr)";

  return (
    <div aria-hidden className={cn("overflow-hidden rounded-[var(--radius-surface)] border border-line bg-panel text-start shadow-modal select-none", className)}>
      {/* The app's toolbar */}
      <div inert className="pointer-events-none flex h-12 items-center justify-between gap-4 border-b border-line bg-background ps-1.5 pe-2 type-base">
        <div className="flex shrink-0 items-center gap-1">
          <span className="grid size-9 place-items-center text-muted-foreground">
            <ArrowLeft className="size-4" />
          </span>
          <span className="hidden px-2 font-medium @min-[40rem]:inline">File</span>
          <span className="hidden px-2 font-medium @min-[40rem]:inline">Edit</span>
          <span className="hidden px-2 font-medium @min-[40rem]:inline">View</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold">Braiding Fibonacci anyons</span>
          <span className="hidden items-center gap-1 type-small text-muted-foreground @min-[40rem]:flex">
            <Check className="size-3.5" />
            Saved
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex -space-x-1.5">
            {[ATIYAH, POINCARE, YOU].map((p) => (
              <Avatar key={p.id} person={{ id: p.id, name: p.name }} size="sm" decorative className="ring-2 ring-background" />
            ))}
          </span>
          <Button variant="outline" size="sm" tabIndex={-1} className="hidden @min-[40rem]:inline-flex">
            <UserPlus />
            Share
          </Button>
          <span className="hidden size-9 place-items-center text-muted-foreground @min-[40rem]:grid">
            <Settings className="size-4" />
          </span>
        </div>
      </div>

      {/* The workspace: a little taller than 16:9 once there is room for the page beside the source; a fixed height on a phone, where the editor and Axya show. */}
      <div
        ref={grid}
        style={{ "--grid-2": grid2, "--grid-3": grid3 } as React.CSSProperties}
        className="grid h-[38rem] grid-cols-1 @min-[48rem]:aspect-[32/19] @min-[48rem]:h-auto @min-[48rem]:grid-cols-[var(--grid-2)] @min-[72rem]:grid-cols-[var(--grid-3)]"
      >
        {/* The sidebar: Files, Review, and Chat as tabs, with Contents under them */}
        <div className="hidden min-h-0 flex-col border-e border-line @min-[72rem]:flex">
          <div className="flex min-h-0 flex-[62] flex-col">
            {/* A comment brings Review to the front, as it does in the app; the scene then turns to Chat to tell the others. */}
            <Tabs names={["Files", "Review", "Chat"]} front={sideTab} onPick={setPickedSide} />
            <div className="relative min-h-0 flex-1 bg-panel">
              <Layer front={sideTab === "Files" || !hydrated}>
                <div className="flex h-12 shrink-0 items-center justify-between border-b border-line ps-3 pe-1.5 type-small text-muted-foreground">
                  <span>5 files</span>
                </div>
                <div className="flex flex-col gap-0.5 p-1.5">
                  {FILES.map((file) => (
                    <div key={file.name} className={cn("flex h-8 items-center gap-1.5 rounded-[var(--radius-item)] px-2 type-base", file.main ? "bg-surface font-medium" : "text-muted-foreground", file.inside && "ps-7")}>
                      {file.folder ? <ChevronRight className={cn("size-4 text-muted-foreground", file.open && "rotate-90")} /> : <span className="size-4" />}
                      <FileTypeIcon filename={file.name} isFolder={file.folder} className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      {file.main && <span className="rounded-[var(--radius-inset)] border border-line px-1.5 type-small font-normal text-muted-foreground">Main</span>}
                    </div>
                  ))}
                </div>
              </Layer>
              {hydrated && (
                <>
                  <Layer front={sideTab === "Review"}>
                    {/* The Review panel: Open and Resolved, the view, then each file's threads under its name. */}
                    <div inert className="pointer-events-none flex shrink-0 items-center gap-2 border-b border-line p-3">
                      <Segmented value={resolved ? "resolved" : "open"} onValueChange={still} label="Show" className="min-w-0 flex-1 [&>*]:flex-1 [&>*]:px-2 [&>*]:whitespace-nowrap" options={[{ value: "open", label: resolved ? "Open" : "Open 1" }, { value: "resolved", label: resolved ? "Resolved 1" : "Resolved" }]} />
                    </div>
                    <div className="scrollbar-modern min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                      <div className="flex min-h-9 min-w-0 items-center gap-2 type-base font-medium">
                        <FileTypeIcon filename="main.tex" className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">main.tex</span>
                        <span className="px-1.5 type-small font-normal tabular-nums text-muted-foreground">1</span>
                      </div>
                      <div inert className="pointer-events-none mt-2">
                        <ThreadView thread={thread} people={PEOPLE} userId={YOU.id} isOwner canEdit variant="card" onReply={stillAsync} onResolve={still} onDeleteThread={still} onEditMessage={stillAsync} onDeleteMessage={still} onSetColor={still} />
                      </div>
                    </div>
                  </Layer>
                  <Layer front={sideTab === "Chat"}>
                    {/* The Chat panel: the latest messages at the foot, with the field under them. */}
                    <div ref={chat} className="scrollbar-modern min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 [mask-image:linear-gradient(to_bottom,transparent,black_2rem)]">
                      <div className="flex min-h-full flex-col justify-end py-3">
                      <ChatMessage person={POINCARE} at={t0 - 50 * 3600_000} now={hydrated}>
                        Pushed the braid figures for section 3 from my laptop. Pull before you touch them.
                      </ChatMessage>
                      <div className="pt-3">
                        <ChatMessage person={YOU} at={t0 - 49 * 3600_000} now={hydrated}>
                          Pulled. The braids look great.
                        </ChatMessage>
                      </div>
                      <div className="pt-3" />
                      <ChatMessage person={ATIYAH} at={t0 - 26 * 3600_000} now={hydrated}>
                        Moved every reference into references.bib, so we cite from one place.
                      </ChatMessage>
                      <p role="separator" className="my-2 flex items-center gap-3 type-small text-muted-foreground">
                        <span className="h-px flex-1 bg-line" />
                        Today
                        <span className="h-px flex-1 bg-line" />
                      </p>
                      <ChatMessage person={POINCARE} at={t0 - 10 * 60_000} now={hydrated}>
                        Section 1 reads well now. I&rsquo;ll start on the proofs.
                      </ChatMessage>
                      <Expand show={sent} className="pt-3">
                        <ChatMessage person={YOU} at={t0} now={hydrated}>
                          {MESSAGE}
                        </ChatMessage>
                      </Expand>
                      <Expand show={replied} className="pt-3">
                        <ChatMessage person={ATIYAH} at={t0} now={hydrated}>
                          {REPLY}
                        </ChatMessage>
                      </Expand>
                      </div>
                    </div>
                    <div inert className="pointer-events-none flex shrink-0 items-end gap-2 border-t border-line p-3">
                      <span className={cn("field flex h-[var(--control-height)] min-w-0 flex-1 items-center rounded-[var(--radius)] px-3 type-base", !chatDraft && "text-muted-foreground")}>
                        <span className="truncate">{chatDraft || "Message everyone in this project"}</span>
                        {chatDraft && <span className="ms-px inline-block h-4 w-0.5 shrink-0 animate-caret-blink bg-foreground" />}
                      </span>
                      <Button size="icon" tabIndex={-1} disabled={!chatDraft}>
                        <Send />
                      </Button>
                    </div>
                  </Layer>
                </>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-[38] flex-col border-t border-line">
            <Tabs names={["Contents", "References", "History"]} front={bottom} onPick={setBottom} />
            <div className="relative min-h-0 flex-1 bg-panel">
              <Layer front={bottom === "Contents"} className="py-1">
                {["Introduction", "Braiding"].map((section, i) => (
                  <div key={section} className="mx-1 flex min-h-8 items-center gap-2 rounded-[var(--radius-item)] ps-2 type-base">
                    <span className="font-mono type-small tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="font-medium">{section}</span>
                  </div>
                ))}
              </Layer>
              <Layer front={bottom === "References"} className="scrollbar-modern overflow-y-auto overscroll-contain p-2">
                {[
                  { key: "freedman02", title: "A modular functor which is universal for quantum computation", who: "Freedman, Larsen, and Wang" },
                  { key: "kitaev03", title: "Fault-tolerant quantum computation by anyons", who: "A. Yu. Kitaev" },
                  { key: "kitaev06", title: "Anyons in an exactly solved model and beyond", who: "Alexei Kitaev" },
                  { key: "nayak08", title: "Non-Abelian anyons and topological quantum computation", who: "Nayak, Simon, Stern, Freedman, and Das Sarma" },
                  { key: "wang10", title: "Topological Quantum Computation", who: "Zhenghan Wang" },
                ].map((r) => (
                  <div key={r.key} className="flex flex-col gap-0.5 rounded-[var(--radius-item)] px-2 py-1.5">
                    <span className="truncate type-base font-medium">{r.title}</span>
                    <span className="truncate type-small text-muted-foreground">
                      {r.who} <span className="font-mono">{r.key}</span>
                    </span>
                  </div>
                ))}
              </Layer>
              {hydrated && (
                <Layer front={bottom === "History"} className="scrollbar-modern overflow-y-auto overscroll-contain p-2">
                  <Expand show={cited}>
                    <HistoryRow person={YOU} what="main.tex" at={t0} />
                  </Expand>
                  <HistoryRow person={ATIYAH} what="references.bib" at={t0 - 26 * 3600_000} />
                  <HistoryRow person={POINCARE} what="figures" at={t0 - 50 * 3600_000} />
                </Layer>
              )}
            </div>
          </div>
        </div>

        {/* The editor, with Axya under it */}
        <div className="flex min-h-0 min-w-0 flex-col border-line @min-[48rem]:border-e">
          <div className="flex min-h-0 flex-[53] flex-col bg-background">
            <Tabs names={["Editor"]} />
            {/* The ribbon: Code or Visual, then the formatting buttons */}
            <div className="flex h-[52px] shrink-0 items-center gap-1 overflow-hidden border-b border-line px-2">
              <Segmented value="code" onValueChange={still} label="Mode" className="pointer-events-none shrink-0" options={[{ value: "code", label: "Code" }, { value: "visual", label: "Visual" }]} />
              <span className="mx-1 h-5 w-px shrink-0 bg-line" />
              {[Bold, Italic, Underline, Code, Sigma, Braces, List].map((Icon, i) => (
                // Only as many as fit whole: on a phone the first four.
                <span key={i} className={cn("size-8 shrink-0 place-items-center text-muted-foreground", i < 4 ? "grid" : "hidden @min-[40rem]:grid")}>
                  <Icon className="size-4" />
                </span>
              ))}
            </div>
            <div ref={code} className="scrollbar-modern min-h-0 flex-1 overflow-y-auto overscroll-contain py-2 font-mono text-[12px] leading-6 @min-[40rem]:text-[13px]">
              {BEFORE_TOKENS.map((tokens, i) => (
                <Line key={i} number={FIRST_LINE + i}>
                  <TexTokens tokens={tokens} />
                </Line>
              ))}
              <Line number={typedLine} active>
                {source}
                {scene.at("write") && <span className="-mb-0.5 ms-px inline-block h-4 w-0.5 animate-caret-blink bg-foreground align-middle" />}
              </Line>
              {AFTER_TOKENS.map((tokens, i) => (
                <Line key={i} number={typedLine + 1 + i}>
                  <TexTokens tokens={tokens} />
                </Line>
              ))}
            </div>
          </div>

          {/* Axya, docked under the editor */}
          <div className="flex min-h-0 flex-[47] flex-col border-t border-line">
            <Tabs names={["Axya"]} />
            <div className="flex min-h-0 flex-1 flex-col bg-panel">
              {/* The conversation, held to its latest line as the app holds it */}
              <div ref={conversation} className="scrollbar-modern min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 [mask-image:linear-gradient(to_bottom,transparent,black_2rem)]">
                <div className="flex min-h-full flex-col justify-end pt-3">
                <div className="flex flex-col items-end gap-1">
                  <div className="max-w-[88%] rounded-[var(--radius-card)] bg-surface px-3.5 py-2.5 type-base text-foreground">Is the fusion rule written the same way everywhere?</div>
                </div>
                <div className="flex flex-col gap-2.5 pt-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <AxyaMark />
                    <span className="type-small font-medium text-foreground">Axya</span>
                    <span className="min-w-0 truncate type-small text-muted-foreground">{MODEL}</span>
                  </div>
                  <p className="type-base leading-relaxed text-foreground">
                    Yes. Line 18 states it, and the theorem counts the same fusion trees.
                  </p>
                </div>

                <Expand show={asked} className="pt-4">
                  <div className="flex flex-col items-end gap-1">
                    <div className="max-w-[88%] rounded-[var(--radius-card)] bg-surface px-3.5 py-2.5 type-base text-foreground">
                      <span className="font-mono font-medium">{COMMAND}</span>
                      {PROMPT.slice(COMMAND.length)}
                    </div>
                  </div>
                </Expand>

                <Expand show={reading || read} className="pt-4">
                  <div className="flex flex-col gap-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <AxyaMark className={cn(!read && "assistant-breathe")} />
                      <span className="type-small font-medium text-foreground">Axya</span>
                      <span className="min-w-0 truncate type-small text-muted-foreground">{MODEL}</span>
                    </div>
                    <div className="flex min-h-7 items-center gap-2 type-small text-muted-foreground">
                      {read ? <Check className="size-4 shrink-0" /> : <Loader2 className="size-4 shrink-0 animate-spin" />}
                      <span>
                        Read <span className="font-mono text-foreground">references.bib</span>
                      </span>
                    </div>
                    <Expand show={read}>
                      <p className="type-base leading-relaxed text-foreground">Freedman, Larsen, and Wang is already in references.bib, so I cited it right after the claim.</p>
                    </Expand>
                  </div>
                </Expand>

                {/* The proposal: one file to review, with its change; accepting it writes the change and the proposal goes. */}
                <Expand show={proposed && !cited} className="pt-4">
                  <section inert className="pointer-events-none flex flex-col gap-2">
                    <div className="flex min-h-9 items-center gap-3">
                      <h3 className="type-base font-medium text-foreground">1 file to review</h3>
                      <span className="inline-flex items-center gap-1.5 type-small tabular-nums">
                        <span className="text-success">+1</span>
                        <span className="text-danger">−1</span>
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
                      <div className="flex min-h-11 items-center gap-1 py-1 ps-1 pe-1.5">
                        <span className="flex min-h-[var(--control-height)] min-w-0 flex-1 items-center gap-2 px-2">
                          <ChevronRight className="size-4 shrink-0 rotate-90 text-muted-foreground" />
                          <FileTypeIcon filename="main.tex" className="size-4 shrink-0" />
                          <span className="min-w-0 truncate type-base font-medium text-foreground">main.tex</span>
                          <span className="inline-flex shrink-0 items-center gap-1.5 type-small tabular-nums">
                            <span className="text-success">+1</span>
                            <span className="text-danger">−1</span>
                          </span>
                        </span>
                        <span className="grid size-8 place-items-center text-muted-foreground">
                          <Eye className="size-4" />
                        </span>
                        <Button variant="outline" size="sm" tabIndex={-1}>
                          Reject
                        </Button>
                        <Button size="sm" tabIndex={-1} className={cn("transition-transform duration-150", pressing && "scale-95")}>
                          Accept
                        </Button>
                      </div>
                      <div className="border-t border-line bg-background font-mono type-small">
                        <div className="flex min-h-9 items-center gap-2 bg-surface/50 ps-3 pe-1 font-sans">
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">Changes line {typedLine}</span>
                          <X className="size-4 text-muted-foreground" />
                          <Check className="me-1.5 size-4 text-muted-foreground" />
                        </div>
                        <div className="flex bg-danger/10 leading-6">
                          <span className="w-9 shrink-0 pe-2 text-end text-muted-foreground/70 tabular-nums">{typedLine}</span>
                          <span className="w-4 shrink-0 text-danger">−</span>
                          <span className="min-w-0 truncate">{SENTENCE}</span>
                        </div>
                        <div className="flex bg-success/10 leading-6">
                          <span className="w-9 shrink-0 pe-2 text-end text-muted-foreground/70 tabular-nums">{typedLine}</span>
                          <span className="w-4 shrink-0 text-success">+</span>
                          <span className="min-w-0 truncate">
                            {SENTENCE.slice(0, -1)}
                            <span className="rounded-[2px] bg-success/30">{tex(CITATION)}</span>.
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>
                </Expand>
                </div>
              </div>

              {/* The composer: the field, then what goes with the question, the model, and send */}
              <div className="shrink-0 p-3">
                <div className="field flex flex-col rounded-[var(--radius-tray)] p-1">
                  <div className="flex min-h-9 items-center px-2.5 type-base">
                    {draft ? (
                      <span className="truncate">
                        <span className="font-mono font-medium">{draft.slice(0, COMMAND.length)}</span>
                        {draft.slice(COMMAND.length)}
                        <span className="ms-px inline-block h-4 w-0.5 animate-caret-blink bg-foreground align-middle" />
                      </span>
                    ) : (
                      <span className="truncate text-muted-foreground">Ask Axya, or type / for commands</span>
                    )}
                  </div>
                  <div className="flex min-h-[var(--control-height)] items-center gap-1">
                    <span className="inline-flex h-[var(--control-height)] min-w-0 items-center gap-1.5 px-2 type-small text-muted-foreground">
                      <FileTypeIcon filename="main.tex" className="size-4 shrink-0 opacity-60" />
                      <span className="truncate">main.tex</span>
                    </span>
                    <span className="ms-auto inline-flex h-[var(--control-height)] min-w-0 items-center gap-1 px-2 type-small text-muted-foreground">
                      <span className="truncate">{MODEL}</span>
                      <ChevronDown className="size-4 shrink-0" />
                    </span>
                    <span className="hidden size-9 shrink-0 place-items-center text-muted-foreground @min-[40rem]:grid">
                      <History className="size-4" />
                    </span>
                    <span className="grid size-9 shrink-0 place-items-center text-muted-foreground">
                      <Mic className="size-4" />
                    </span>
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-[var(--radius)] transition-colors duration-200", draft ? "bg-accent text-on-accent" : "bg-surface text-muted-foreground")}>
                      <ArrowUp className="size-4" />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The compiled page: the document above, typeset by TeX, the column as wide as the page */}
        <div className="hidden min-h-0 min-w-0 flex-col bg-surface/40 @min-[48rem]:flex">
          <Tabs names={["PDF"]} />
          <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-2">
            <span className={cn("flex h-[var(--control-height)] items-stretch overflow-hidden rounded-[var(--radius)] bg-accent type-base font-medium text-on-accent transition-[scale,opacity] duration-150 motion-still:transition-none", compiling && "scale-[0.97] opacity-85")}>
              <span className="flex items-center gap-1.5 ps-3 pe-3">
                {compiling ? <Loader2 className="size-4 animate-spin motion-still:animate-none" /> : <Play className="size-4" />}
                {compiling ? "Compiling" : "Recompile"}
              </span>
              <span className="flex items-center border-s border-on-accent/25 px-2">
                <ChevronDown className="size-4" />
              </span>
            </span>
            <span className="grid size-9 place-items-center text-muted-foreground">
              <Download className="size-4" />
            </span>
            <span className="ms-auto flex items-center text-muted-foreground">
              <span className="grid size-9 place-items-center">
                <ZoomOut className="size-4" />
              </span>
              <span className="type-small tabular-nums">Fit</span>
              <span className="grid size-9 place-items-center">
                <ZoomIn className="size-4" />
              </span>
            </span>
          </div>
          {/* The whole page, the full height of the column. The three states are stacked and the current one is on top, so the page changes without a flash. */}
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden [container-type:size]">
            <div className="relative aspect-[419.528/595.276] w-[min(100cqw,calc(100cqh*419.528/595.276))] overflow-hidden bg-paper">
              {[1, 2, 3].map((n) => (
                // eslint-disable-next-line @next/next/no-img-element -- A static SVG of a compiled page: the image optimizer has nothing to do with it.
                <img key={n} src={HERO_PAGES[n - 1]} alt="" draggable={false} className={cn("absolute inset-0 size-full transition-opacity duration-500 motion-still:transition-none", page === n ? "opacity-100" : "opacity-0")} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
