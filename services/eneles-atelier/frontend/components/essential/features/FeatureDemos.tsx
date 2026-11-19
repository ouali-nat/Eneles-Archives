"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, GitBranch, Mic, Play, RotateCcw } from "@/components/icons";
import { Tex } from "@/components/essential/home/_shared";
import { TikzThumb } from "@/components/essential/library/TikzThumb";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Kbd, kbdClass } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/segmented";
import { BusyFaces, DrawnCheck, Spinner, type BusyState } from "@/components/ui/status";
import { Switch } from "@/components/ui/switch";
import { TexLine, TexSource } from "@/components/ui/tex-code";
import { useMotion } from "@/hooks/useMotion";
import { LATEX_SNIPPETS } from "@/lib/latex/snippets";
import { tikzLibraries } from "@/lib/tikz/libraries";
import { cn } from "@/lib/utils";
import { HERO_PAGES } from "@/components/essential/home/hero-pages";

/*
 * Working miniatures of Eneles's features for the Features page. Each is the feature reduced to its point: no project, no account, no network (except the TikZ figures, which are the library's real renders, and the compiled page, which is the home page's example document as TeX set it). They are drawn the way the editor draws things (the same tab strips, numbered and colored source, cards, and controls), so what a visitor tries here is what they will find inside.
 */

/* ── Shared pieces ───────────────────────────────────────────────────────── */

const mono = "font-mono text-[13px] leading-6";
const pane = "rounded-[var(--radius-card)] border border-line bg-background";

/** The window every demo sits in, drawn as a panel of the editor: a tab strip whose front tab carries a line along its top, controls at the end of the strip, the demo, and sometimes a status line along the foot. */
function Window({ tabs, front, actions, footer, children, className }: { tabs: string[]; front?: string; actions?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  const shown = front ?? tabs[0];
  return (
    <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-panel shadow-lit-drop">
      <div className="flex min-h-11 items-stretch justify-between gap-3 border-b border-line bg-background">
        <div className="flex min-w-0 items-stretch">
          {tabs.map((tab) => (
            <span key={tab} className={cn("flex items-center px-4 type-base", tab === shown ? "bg-panel font-medium shadow-[inset_0_2px_0_var(--foreground)]" : "text-muted-foreground")}>
              <span className="truncate">{tab}</span>
            </span>
          ))}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 py-1 pe-1.5">{actions}</div>}
      </div>
      <div className={className}>{children}</div>
      {footer && <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-background px-4 py-1.5 type-small text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** One numbered line of source. */
function Line({ n, active, tone, children }: { n: number; active?: boolean; tone?: "error" | "added"; children?: ReactNode }) {
  return (
    <div className={cn("flex min-h-6", active && "bg-surface/60", tone === "error" && "bg-danger/10", tone === "added" && "bg-success/10")}>
      <span className={cn("w-11 shrink-0 pe-3 text-end tabular-nums select-none", active ? "text-foreground" : tone === "error" ? "text-danger" : "text-muted-foreground/60")}>{n}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

/** Numbered, colored source: the lines as they are, starting at `start`. */
function Source({ lines, start = 1, className }: { lines: string[]; start?: number; className?: string }) {
  return (
    <div className={cn(mono, "py-3", className)}>
      {lines.map((line, i) => (
        <Line key={i} n={start + i}>
          <TexLine text={line} />
        </Line>
      ))}
    </div>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <RotateCcw aria-hidden />
      Reset
    </Button>
  );
}

/** A person, as a round face in their hue with their initial. */
function Face({ name, tone, className }: { name: string; tone: string; className?: string }) {
  return (
    <span title={name} className={cn("grid size-6 shrink-0 place-items-center rounded-full type-micro font-semibold text-background", tone, className)}>
      {name[0]}
    </span>
  );
}

/** True once the element has scrolled into view. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}

/** A named cursor, as collaborators appear in the editor. */
function Caret({ name, tone }: { name: string; tone: string }) {
  return (
    <span className="relative inline-block h-[1.15em] w-0 align-text-bottom">
      <span className={cn("absolute inset-y-0 -start-px w-[2px]", tone)} />
      <span className={cn("absolute -top-[1.1rem] -start-px rounded-[3px] rounded-es-none px-1.5 font-sans type-micro font-medium whitespace-nowrap text-background", tone)}>{name}</span>
    </span>
  );
}

/* ── 1. Real-time collaboration ──────────────────────────────────────────── */

const BOTS = [
  { name: "Euler", tone: "bg-hue-blue", line: 1, prefix: "We sample ", phrases: ["each batch uniformly at random.", "mini-batches of size $b$ without replacement."] },
  { name: "Gauss", tone: "bg-hue-purple", line: 3, prefix: "The bound holds for ", phrases: ["all $n \\ge 2$.", "every $n$, by Lemma~\\ref{lem:mono}."] },
];
const COLLAB_REST = ["", "\\begin{equation}", "  \\hat{g} = \\frac{1}{b} \\sum_{i \\in B} \\nabla f_i(x)", "\\end{equation}"];

export function CollabDemo() {
  const { animates } = useMotion();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [typed, setTyped] = useState(() => BOTS.map((b) => b.phrases[0].length));
  const [phrase, setPhrase] = useState(() => BOTS.map(() => 0));
  const [mine, setMine] = useState("");

  // Each collaborator types their sentence, rests, then rewrites it.
  useEffect(() => {
    if (!animates || !seen) return;
    const rest = BOTS.map(() => 0);
    const pos = BOTS.map(() => 0);
    const which = BOTS.map(() => 0);
    const timer = window.setInterval(() => {
      BOTS.forEach((bot, i) => {
        const text = bot.phrases[which[i]];
        if (pos[i] < text.length) pos[i] += 1;
        else if (++rest[i] > 28 + i * 9) {
          rest[i] = 0;
          pos[i] = 0;
          which[i] = (which[i] + 1) % bot.phrases.length;
        }
      });
      setTyped([...pos]);
      setPhrase([...which]);
    }, 85);
    return () => window.clearInterval(timer);
  }, [animates, seen]);

  return (
    <div ref={ref}>
      <Window
        tabs={["main.tex"]}
        actions={
          <span className="flex items-center pe-2">
            {[...BOTS, { name: "You", tone: "bg-foreground" }].map((p) => (
              <Face key={p.name} name={p.name} tone={p.tone} className="-ms-1.5 size-7 ring-2 ring-background" />
            ))}
          </span>
        }
        footer={
          <>
            <span className="flex items-center gap-2 text-foreground">
              <span aria-hidden className="size-2 rounded-full bg-success" />
              Live
            </span>
            <span>3 people in main.tex</span>
            <span className="ms-auto">Edits to the same line merge</span>
          </>
        }
      >
        <div className={cn(mono, "pt-7 pb-4")}>
          <Line n={1}>
            <TexLine text="\section{Method}" />
          </Line>
          {[1, 2, 3].map((i) => {
            const bot = BOTS.find((b) => b.line === i);
            if (!bot)
              return (
                <Line key={i} n={i + 1} active>
                  <input value={mine} onChange={(e) => setMine(e.target.value)} placeholder="Type here. You are the third cursor." aria-label="Your line in the shared document" spellCheck={false} className="w-full bg-transparent caret-foreground outline-none placeholder:text-muted-foreground/70" />
                </Line>
              );
            const index = BOTS.indexOf(bot);
            return (
              <Line key={i} n={i + 1}>
                <TexLine text={bot.prefix + bot.phrases[phrase[index]].slice(0, typed[index])} />
                <Caret name={bot.name} tone={bot.tone} />
              </Line>
            );
          })}
          {COLLAB_REST.map((line, i) => (
            <Line key={i} n={5 + i}>
              <TexLine text={line} />
            </Line>
          ))}
        </div>
      </Window>
    </div>
  );
}

/* ── 2. Track changes and comments ───────────────────────────────────────── */

type Decision = "pending" | "accepted" | "rejected";
const SUGGESTIONS = [
  { id: "a", del: "loose", ins: "tight up to a constant" },
  { id: "b", del: "large $n$", ins: "all $n \\ge 2$" },
];

export function ReviewDemo() {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({ a: "pending", b: "pending" });
  const [replies, setReplies] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [resolved, setResolved] = useState(false);
  const decide = (id: string, d: Decision) => setDecisions((s) => ({ ...s, [id]: d }));
  const pending = SUGGESTIONS.filter((s) => decisions[s.id] === "pending");

  // A suggestion in the text: both sides while it waits (the old struck through, the new marked), and one side once it is settled.
  const part = (s: (typeof SUGGESTIONS)[number]) => {
    const d = decisions[s.id];
    if (d === "accepted") return <TexLine text={s.ins} />;
    if (d === "rejected") return <TexLine text={s.del} />;
    return (
      <>
        <span className="text-danger line-through decoration-danger/60">{s.del}</span> <span className="rounded-[2px] bg-success/15 text-success underline decoration-success/50 underline-offset-2">{s.ins}</span>
      </>
    );
  };

  return (
    <Window
      tabs={["main.tex"]}
      actions={
        <ResetButton
          onClick={() => {
            setDecisions({ a: "pending", b: "pending" });
            setReplies([]);
            setResolved(false);
          }}
        />
      }
    >
      <div className={cn(mono, "bg-background py-4")}>
        <Line n={12}>
          <TexLine text="\begin{theorem}" />
        </Line>
        <Line n={13} active>
          {"  "}
          <span className={cn("rounded-[2px] transition-colors", !resolved && "bg-hue-amber/25 shadow-[inset_0_-1.5px_0_var(--hue-amber)]")}>The bound</span> is {part(SUGGESTIONS[0])} for
        </Line>
        <Line n={14}>
          {"  "}
          {part(SUGGESTIONS[1])}.
        </Line>
        <Line n={15}>
          <TexLine text="\end{theorem}" />
        </Line>
      </div>

      {/* The Review panel, as it sits beside the text in the editor. */}
      <div className="grid items-start gap-3 border-t border-line p-3 @min-[38rem]:grid-cols-2">
        <section aria-label="Suggested changes" className="flex flex-col gap-2">
          <div className="flex min-h-9 items-center gap-2">
            <h3 className="flex-1 type-base font-semibold">
              Suggested changes <span className="font-normal text-muted-foreground">{pending.length}</span>
            </h3>
            {pending.length > 1 && (
              <Button size="sm" variant="outline" onClick={() => setDecisions({ a: "accepted", b: "accepted" })}>
                Accept all
              </Button>
            )}
          </div>
          {pending.length === 0 && (
            <p className="flex items-center gap-2 type-base text-muted-foreground">
              <DrawnCheck className="text-success" /> Every change is settled.
            </p>
          )}
          {pending.map((s) => (
            <div key={s.id} className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border border-line bg-card p-3 [animation:status-in_220ms_ease] motion-off:[animation:none]">
              <p className="flex items-center gap-2 type-base">
                <Face name="Euclid" tone="bg-hue-blue" />
                <span className="font-medium">Euclid</span> <span className="text-muted-foreground">replaced</span>
              </p>
              <div className="overflow-hidden rounded-[var(--radius-inset)] border border-line font-mono type-small">
                <p className="bg-danger/10 px-2 py-1">
                  <span className="text-danger">− </span>
                  <TexLine text={s.del} />
                </p>
                <p className="bg-success/10 px-2 py-1">
                  <span className="text-success">+ </span>
                  <TexLine text={s.ins} />
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" aria-label={`Reject replacing ${s.del}`} onClick={() => decide(s.id, "rejected")}>
                  Reject
                </Button>
                <Button size="sm" variant="outline" aria-label={`Accept replacing ${s.del}`} onClick={() => decide(s.id, "accepted")}>
                  <Check /> Accept
                </Button>
              </div>
            </div>
          ))}
        </section>

        <section aria-label="Comment" className="flex flex-col gap-2">
          <h3 className="flex min-h-9 items-center type-base font-semibold">
            Comments <span className="ms-1.5 font-normal text-muted-foreground">{resolved ? 0 : 1}</span>
          </h3>
          <div className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border border-line bg-card p-3">
          <p className="border-s-2 border-hue-amber ps-2 font-mono type-small text-muted-foreground">The bound</p>
          <p className="flex items-start gap-2 type-base">
            <Face name="Plato" tone="bg-hue-purple" />
            <span className="min-w-0">
              <span className="font-medium">Plato</span>
              <span className="block">Cite the lemma here?</span>
            </span>
          </p>
          {replies.map((r, i) => (
            <p key={i} className="flex items-start gap-2 type-base">
              <Face name="You" tone="bg-foreground" />
              <span className="min-w-0">
                <span className="font-medium">You</span>
                <span className="block [overflow-wrap:anywhere]">{r}</span>
              </span>
            </p>
          ))}
          {resolved ? (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 type-base font-medium text-success">
                <Check className="size-4" /> Resolved
              </span>
              <Button size="sm" variant="outline" onClick={() => setResolved(false)}>
                Reopen
              </Button>
            </div>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                setReplies((r) => [...r, draft.trim()]);
                setDraft("");
              }}
            >
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply" aria-label="Reply to the comment" className="min-w-0 flex-1" />
              <Button type="button" variant="outline" onClick={() => setResolved(true)}>
                <Check /> Resolve
              </Button>
            </form>
          )}
          </div>
        </section>
      </div>
    </Window>
  );
}

/* ── 3. Code and visual editing ──────────────────────────────────────────── */

const VISUAL_SOURCE = ["\\section{Results}", "The \\textbf{energy} of a particle at rest", "is given by \\cite{einstein1905}:", "\\begin{equation}", "  E = mc^2", "\\end{equation}", "\\begin{itemize}", "  \\item $m$ is the rest mass", "  \\item $c$ is the speed of light", "\\end{itemize}"];

export function VisualDemo() {
  const [mode, setMode] = useState<"code" | "visual">("visual");
  return (
    <Window
      tabs={["main.tex"]}
      actions={
        <Segmented
          value={mode}
          onValueChange={setMode}
          label="Editor mode"
          options={[
            { value: "code", label: "Code" },
            { value: "visual", label: "Visual" },
          ]}
        />
      }
      footer={<span>{mode === "code" ? "The file as it is saved." : "The same file, drawn as it will read. The source shows where the cursor is."}</span>}
      className="min-h-[19rem] bg-background"
    >
      {mode === "code" ? (
        <Source lines={VISUAL_SOURCE} className="py-4" />
      ) : (
        // The document's own face: the one the math is set in, as Visual mode uses.
        <div className="mx-auto max-w-[34rem] px-6 py-6 text-[17px] leading-7 [font-family:KaTeX_Main,'Times_New_Roman',serif]">
          <h4 className="text-[1.5rem] leading-tight font-bold">
            <span className="me-3 text-muted-foreground">1</span>Results
          </h4>
          <p className="mt-4">
            The <strong>energy</strong> of a particle at rest is given by <span className="rounded-[var(--radius-inset)] border border-hue-teal/40 bg-hue-teal/10 px-1.5 py-0.5 font-mono text-[13px] text-hue-teal">[einstein1905]</span>:
          </p>
          <div className="my-3 flex items-center">
            <span className="flex-1 text-center">
              <Tex>{"E = mc^2"}</Tex>
            </span>
            <span>(1)</span>
          </div>
          <ul className="list-disc ps-7 marker:text-muted-foreground">
            <li>
              <Tex>{"m"}</Tex> is the rest mass
            </li>
            <li>
              <Tex>{"c"}</Tex> is the speed of light
            </li>
          </ul>
        </div>
      )}
    </Window>
  );
}

/* ── 4. Image and PDF to LaTeX ───────────────────────────────────────────── */

const SAMPLES = [
  { id: "integral", label: "Integral", tex: "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}" },
  { id: "matrix", label: "Matrix", tex: "A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" },
  { id: "series", label: "Series", tex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}" },
] as const;

export function ConvertDemo() {
  const { animates } = useMotion();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [sample, setSample] = useState<(typeof SAMPLES)[number]["id"]>("integral");
  const [state, setState] = useState<BusyState>("idle");
  const [shown, setShown] = useState(0);
  const tex = SAMPLES.find((s) => s.id === sample)!.tex;
  const timers = useRef<number[]>([]);

  const convert = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setShown(0);
    setState("busy");
    const scan = animates ? 1100 : 0;
    timers.current.push(
      window.setTimeout(() => {
        setState("success");
        if (!animates) return setShown(tex.length);
        for (let i = 1; i <= tex.length; i++) timers.current.push(window.setTimeout(() => setShown(i), i * 14));
      }, scan),
      window.setTimeout(() => setState("idle"), scan + 1800),
    );
  };
  // Runs once when first seen, and again whenever another sample is chosen.
  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (!seen || ran.current === sample) return;
    ran.current = sample;
    convert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, sample]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  const complete = shown === tex.length && state !== "busy";

  return (
    <div ref={ref}>
      <Window tabs={["Snip"]} actions={<Segmented value={sample} onValueChange={setSample} label="Sample image" options={SAMPLES.map((s) => ({ value: s.id, label: s.label }))} />} className="grid gap-3 p-3 @min-[38rem]:grid-cols-2">
        {/* The "photo": the formula in ink on paper, wobbled so it reads as handwriting. */}
        <figure className="relative grid min-h-56 place-items-center overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper p-4 text-paper-ink">
          <svg aria-hidden className="absolute size-0">
            <filter id="demo-hand">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
              <feDisplacementMap in="SourceGraphic" scale="5" />
            </filter>
          </svg>
          <div className="-rotate-2 [filter:url(#demo-hand)] [&_.katex]:text-[1.3rem]">
            <Tex display>{tex}</Tex>
          </div>
          {state === "busy" && <span aria-hidden className="absolute inset-x-0 top-0 h-12 bg-linear-to-b from-transparent to-accent/25 [animation:demo-scan_1.1s_ease-in-out] motion-still:hidden" />}
          <figcaption className="absolute start-3 bottom-2 font-sans type-small text-paper-ink/60">A photo of handwritten notes</figcaption>
        </figure>

        <div className="flex min-w-0 flex-col gap-3">
          <div className={cn(pane, "flex min-h-24 flex-1 flex-col")}>
            <p className="border-b border-line px-3 py-2 type-small font-medium text-muted-foreground">LaTeX</p>
            <code className={cn(mono, "block flex-1 p-3 [overflow-wrap:anywhere]")}>
              {state === "busy" ? <span className="text-muted-foreground">Reading the image</span> : <TexLine text={`\\[ ${tex.slice(0, shown)}`} />}
              {complete && <TexLine text=" \]" />}
            </code>
          </div>
          <div className={cn(pane, "flex flex-col")}>
            <p className="border-b border-line px-3 py-2 type-small font-medium text-muted-foreground">Compiles to</p>
            <div className={cn("grid min-h-16 place-items-center px-3 py-2 transition-opacity duration-300", complete ? "opacity-100" : "opacity-0")}>
              <Tex display>{tex}</Tex>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" aria-busy={state === "busy" || undefined} onClick={() => state !== "busy" && convert()}>
              <BusyFaces state={state} busyLabel="Converting" successLabel="Converted" errorLabel="Failed">
                Convert again
              </BusyFaces>
            </Button>
            <CopyButton text={tex} />
          </div>
        </div>
      </Window>
    </div>
  );
}

/* ── 5. TikZ library ─────────────────────────────────────────────────────── */

const FIGURES = (
  [
    ["tikz-cd", "basic-square", "Square"],
    ["quantikz", "bell-state", "Bell state"],
    ["tikz-cd", "pullback", "Pullback"],
  ] as const
).flatMap(([libraryId, exampleId, label]) => {
  const library = tikzLibraries.find((l) => l.id === libraryId);
  const example = library?.examples.find((e) => e.id === exampleId);
  return library && example ? [{ key: `${libraryId}/${exampleId}`, libraryId, library: library.name, example, label }] : [];
});

export function TikzDemo() {
  const [key, setKey] = useState(FIGURES[0]?.key ?? "");
  const figure = FIGURES.find((f) => f.key === key) ?? FIGURES[0];
  if (!figure) return null;
  return (
    <Window
      tabs={["Library"]}
      actions={<Segmented value={key} onValueChange={setKey} label="Figure" options={FIGURES.map((f) => ({ value: f.key, label: f.label }))} />}
      footer={
        <>
          <span className="font-mono text-foreground">{figure.library}</span>
          <span className="min-w-0 truncate">{figure.example.name}</span>
          <a href={`/library/${figure.libraryId}/${figure.example.id}`} className="ms-auto font-medium text-foreground underline-offset-4 hover:underline">
            Open in the library
          </a>
        </>
      }
      className="grid gap-3 p-3 @min-[38rem]:grid-cols-2"
    >
      <TikzThumb key={figure.key} libraryId={figure.libraryId} exampleId={figure.example.id} source={figure.example.source} name={figure.example.name} />
      <div className={cn(pane, "relative flex min-w-0 flex-col")}>
        <div className="flex items-center justify-between border-b border-line py-1 ps-3 pe-1">
          <p className="type-small font-medium text-muted-foreground">Source</p>
          <CopyButton text={figure.example.source} />
        </div>
        <pre className={cn(mono, "max-h-64 flex-1 overflow-y-auto p-3 whitespace-pre-wrap [overflow-wrap:anywhere]")}>
          <TexSource source={figure.example.source} />
        </pre>
      </div>
    </Window>
  );
}

/* ── 6. AI assistant and dictation ───────────────────────────────────────── */

const AI_FIRST_LINE = 21;
const AI_SOURCE = ["\\begin{align}", "  E = mc^2", "\\end{align}"];
const AI_TASKS = [
  { id: "momentum", label: "Add the momentum term", prompt: "Add the momentum term to the energy equation", reply: "I replaced the rest-energy relation with the full energy–momentum relation.", line: 1, next: "  E^2 = (mc^2)^2 + (pc)^2" },
  { id: "label", label: "Label the equation", prompt: "Label the equation so I can reference it", reply: "I added a label after the equation. Reference it with \\eqref{eq:energy}.", line: 1, next: "  E = mc^2 \\label{eq:energy}" },
];

export function AiDemo() {
  const { animates } = useMotion();
  const [source, setSource] = useState(AI_SOURCE);
  const [task, setTask] = useState<(typeof AI_TASKS)[number] | null>(null);
  const [phase, setPhase] = useState<"idle" | "listening" | "thinking" | "proposed" | "applied" | "rejected">("idle");
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, animates ? ms : 0));
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  const busy = phase === "thinking" || phase === "listening";

  const ask = (t: (typeof AI_TASKS)[number], dictated = false) => {
    setSource(AI_SOURCE);
    setTask(t);
    setPhase(dictated ? "listening" : "thinking");
    if (dictated) later(() => setPhase("thinking"), 1500);
    later(() => setPhase("proposed"), dictated ? 2500 : 1000);
  };

  return (
    <Window
      tabs={["main.tex"]}
      actions={
        <ResetButton
          onClick={() => {
            setSource(AI_SOURCE);
            setTask(null);
            setPhase("idle");
          }}
        />
      }
    >
      <div className={cn(mono, "bg-background py-3")}>
        {source.map((line, i) => (
          <Line key={i} n={AI_FIRST_LINE + i} tone={phase === "applied" && task?.line === i ? "added" : undefined}>
            <TexLine text={line} />
          </Line>
        ))}
      </div>

      {/* The assistant's panel, docked under the source as it is in the editor. */}
      <div className="flex min-h-10 items-stretch border-y border-line bg-background">
        <span className="flex items-center bg-panel px-4 type-base font-medium shadow-[inset_0_2px_0_var(--foreground)]">Axya</span>
      </div>
      <div className="flex min-h-48 flex-col gap-3 p-3">
        {!task && <p className="m-auto max-w-sm text-center type-base text-muted-foreground">Ask for a change in plain words. It arrives as a diff, and nothing changes until you accept it.</p>}
        {task && (
          <>
            <p className="ms-auto max-w-[85%] rounded-[var(--radius-card)] bg-surface px-3 py-2 type-base">
              {phase === "listening" ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span aria-hidden className="flex h-4 items-center gap-0.5">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} style={{ animationDelay: `${i * 90}ms` }} className="w-0.5 rounded-full bg-current [animation:demo-level_700ms_ease-in-out_infinite] motion-still:h-2 motion-still:[animation:none]" />
                    ))}
                  </span>
                  Listening
                </span>
              ) : (
                task.prompt
              )}
            </p>
            {phase === "thinking" && (
              <p className="flex items-center gap-2 type-base text-muted-foreground">
                <Spinner /> Reading main.tex
              </p>
            )}
            {(phase === "proposed" || phase === "applied" || phase === "rejected") && (
              <div className="flex flex-col gap-2.5 [animation:status-in_220ms_ease] motion-off:[animation:none]">
                <p className="type-base">{task.reply}</p>
                {/* The proposal: the file, what it adds and removes, and the two answers. */}
                <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
                  <div className="flex min-h-11 items-center gap-2 py-1 ps-3 pe-1.5">
                    <span className="type-base font-medium">main.tex</span>
                    <span className="type-small tabular-nums text-success">+1</span>
                    <span className="type-small tabular-nums text-danger">−1</span>
                    <span className="ms-auto flex items-center gap-1">
                      {phase === "proposed" ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setPhase("rejected")}>
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSource(AI_SOURCE.map((l, i) => (i === task.line ? task.next : l)));
                              setPhase("applied");
                            }}
                          >
                            Accept
                          </Button>
                        </>
                      ) : (
                        <span className={cn("flex h-[var(--control-height)] items-center gap-1.5 px-2.5 type-base font-medium", phase === "applied" ? "text-success" : "text-muted-foreground")}>
                          {phase === "applied" && <DrawnCheck />}
                          {phase === "applied" ? "Accepted" : "Rejected"}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className={cn(mono, "border-t border-line bg-background")}>
                    <Line n={AI_FIRST_LINE + task.line} tone="error">
                      <span className="text-danger">− </span>
                      <TexLine text={AI_SOURCE[task.line].trim()} />
                    </Line>
                    <Line n={AI_FIRST_LINE + task.line} tone="added">
                      <span className="text-success">+ </span>
                      <TexLine text={task.next.trim()} />
                    </Line>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-background p-3">
        {AI_TASKS.map((t) => (
          <Button key={t.id} size="sm" variant="outline" disabled={busy} title={t.prompt} onClick={() => ask(t)}>
            {t.label}
          </Button>
        ))}
        <Button size="sm" variant="outline" className="ms-auto" disabled={busy} onClick={() => ask(AI_TASKS[0], true)}>
          <Mic aria-hidden />
          Dictate
        </Button>
      </div>
    </Window>
  );
}

/* ── 7. Compiling ────────────────────────────────────────────────────────── */

/* The home page's example document (scripts/hero-document/main.tex): these are its lines 18 and 19, and the pages are that document as TeX set it, before and after the citation. */
const PASSES = ["pdflatex main.tex", "bibtex main", "pdflatex main.tex", "pdflatex main.tex"];
const BUILD_LINES = ["\\[ \\tau \\otimes \\tau = 1 \\oplus \\tau. \\]", "Their braiding alone is dense in $SU(2)$~\\cite{freedman02}."];
const BROKEN_LINE = "Their braiding alone is dense in $SU(2)$~\\cit{freedman02}.";

export function BuildDemo() {
  const { animates } = useMotion();
  const [broken, setBroken] = useState(false);
  const [state, setState] = useState<BusyState>("idle");
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<"none" | "ok" | "error">("none");
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const compile = () => {
    if (state === "busy") return;
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setDone(0);
    setResult("none");
    setState("busy");
    const step = animates ? 420 : 0;
    const passes = broken ? 1 : PASSES.length;
    for (let i = 1; i <= passes; i++) timers.current.push(window.setTimeout(() => setDone(i), i * step));
    timers.current.push(
      window.setTimeout(() => {
        setResult(broken ? "error" : "ok");
        setState(broken ? "error" : "success");
      }, passes * step + 150),
      window.setTimeout(() => setState("idle"), passes * step + 1900),
    );
  };

  return (
    <Window tabs={["main.tex"]} className="grid @min-[38rem]:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div className="flex min-w-0 flex-col bg-background">
        <div className={cn(mono, "py-3")}>
          <Line n={18}>
            <TexLine text={BUILD_LINES[0]} />
          </Line>
          <Line n={19} active={result !== "error"} tone={result === "error" ? "error" : undefined}>
            <TexLine text={broken ? BROKEN_LINE : BUILD_LINES[1]} />
          </Line>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-y border-line px-4 type-base">
          <span>
            Break line 19 <span className="text-muted-foreground">with a command that does not exist</span>
          </span>
          <Switch checked={broken} onCheckedChange={setBroken} />
        </label>
        {/* The log: each pass as it finishes, then the outcome. */}
        <ol className={cn(mono, "min-h-36 flex-1 px-4 py-3 text-muted-foreground")}>
          {done === 0 && result === "none" && state !== "busy" && <li className="font-sans type-base">Press Recompile to build the PDF.</li>}
          {PASSES.slice(0, done).map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-muted-foreground/60 tabular-nums">{i + 1}</span> {p}
            </li>
          ))}
          {result === "ok" && (
            <li className="mt-1 flex items-center gap-2 font-sans type-base text-success">
              <DrawnCheck /> main.pdf, 1 page, citations resolved
            </li>
          )}
          {result === "error" && (
            <li className="mt-1 flex items-start gap-2 font-sans type-base text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>
                main.tex, line 19: Undefined control sequence <span className="font-mono">\cit</span>
              </span>
            </li>
          )}
        </ol>
      </div>

      <div className="flex min-w-0 flex-col border-t border-line @min-[38rem]:border-s @min-[38rem]:border-t-0">
        <div className="flex h-13 shrink-0 items-center gap-3 border-b border-line px-2">
          <Button aria-busy={state === "busy" || undefined} onClick={compile}>
            <BusyFaces state={state} busyLabel="Compiling" successLabel="Compiled" errorLabel="Failed">
              <Play aria-hidden />
              Recompile
            </BusyFaces>
          </Button>
          <span className="ms-auto pe-2 type-small text-muted-foreground tabular-nums">1 / 1</span>
        </div>
        {/* The page TeX produced: before the compile, the last one; after it, the new one with the citation and the reference list. */}
        <div className="relative min-h-64 flex-1 overflow-hidden bg-surface/40 px-5 pt-5">
          <div className={cn("relative mx-auto aspect-[419.528/595.276] w-full max-w-[22rem] overflow-hidden rounded-t-[2px] bg-paper shadow-lit-drop transition-opacity duration-300", state === "busy" && "opacity-50")}>
            {[2, 3].map((n) => (
              // eslint-disable-next-line @next/next/no-img-element -- A static SVG of a compiled page: the image optimizer has nothing to do with it.
              <img key={n} src={HERO_PAGES[n - 1]} alt="" draggable={false} className={cn("absolute inset-0 size-full transition-opacity duration-500 motion-still:transition-none", (result === "ok" ? 3 : 2) === n ? "opacity-100" : "opacity-0")} />
            ))}
          </div>
          {result === "error" && <p className="absolute inset-x-3 bottom-3 rounded-[var(--radius)] border border-line bg-panel px-3 py-2 type-small text-muted-foreground shadow-popover">The build stopped at the error. This is the last PDF that compiled.</p>}
        </div>
      </div>
    </Window>
  );
}

/* ── 8. References ───────────────────────────────────────────────────────── */

const PAPERS = [
  { id: "arXiv:1706.03762", key: "vaswani2017attention", bib: "@article{vaswani2017attention,\n  title  = {Attention Is All You Need},\n  author = {Vaswani, Ashish and Shazeer, Noam and others},\n  year   = {2017},\n  eprint = {1706.03762}\n}" },
  { id: "10.1038/nature14539", key: "lecun2015deep", bib: "@article{lecun2015deep,\n  title   = {Deep learning},\n  author  = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},\n  journal = {Nature},\n  year    = {2015},\n  doi     = {10.1038/nature14539}\n}" },
];

export function ReferencesDemo() {
  const { animates } = useMotion();
  const [value, setValue] = useState(PAPERS[0].id);
  const [state, setState] = useState<BusyState>("idle");
  const [added, setAdded] = useState<typeof PAPERS>([]);
  const [message, setMessage] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const add = () => {
    const paper = PAPERS.find((p) => p.id.toLowerCase() === value.trim().toLowerCase() || p.id.replace(/^arXiv:/, "") === value.trim());
    if (!paper) return setMessage("This demo knows the two sample identifiers. In the editor, any DOI or arXiv ID works.");
    if (added.includes(paper)) return setMessage("Already in references.bib.");
    setMessage(null);
    setState("busy");
    timers.current.push(
      window.setTimeout(
        () => {
          setAdded((a) => [...a, paper]);
          setState("success");
        },
        animates ? 800 : 0,
      ),
      window.setTimeout(() => setState("idle"), 2400),
    );
  };

  return (
    <Window
      tabs={["Add a reference"]}
      actions={
        <ResetButton
          onClick={() => {
            setAdded([]);
            setMessage(null);
          }}
        />
      }
      className="flex flex-col"
    >
      <div className="flex flex-col gap-2.5 p-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label="DOI or arXiv ID" placeholder="DOI or arXiv ID" spellCheck={false} className="min-w-0 flex-1 font-mono" />
          <Button type="submit" aria-busy={state === "busy" || undefined}>
            <BusyFaces state={state} busyLabel="Looking up" successLabel="Added" errorLabel="Not found">
              Add and cite
            </BusyFaces>
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-2 type-small text-muted-foreground">
          Try
          {PAPERS.map((p) => (
            <Button key={p.id} size="sm" variant="outline" className="font-mono" onClick={() => setValue(p.id)}>
              {p.id}
            </Button>
          ))}
        </div>
        {message && <p className="type-small text-muted-foreground">{message}</p>}
      </div>

      <div className="grid border-t border-line @min-[38rem]:grid-cols-2">
        <div className="min-w-0 bg-background">
          <p className="border-b border-line px-4 py-2 type-small font-medium text-muted-foreground">main.tex</p>
          <p className={cn(mono, "min-h-28 p-4 [overflow-wrap:anywhere]")}>
            Transformers
            {added.map((p) => (
              <span key={p.key} className="rounded-[2px] bg-success/10 [animation:status-in_220ms_ease] motion-off:[animation:none]">
                <TexLine text={`~\\cite{${p.key}}`} />
              </span>
            ))}{" "}
            changed how sequences are modeled.
          </p>
        </div>
        <div className="min-w-0 border-t border-line bg-background @min-[38rem]:border-s @min-[38rem]:border-t-0">
          <p className="border-b border-line px-4 py-2 type-small font-medium text-muted-foreground">references.bib</p>
          {added.length === 0 ? (
            <p className="grid min-h-28 place-items-center p-4 type-base text-muted-foreground">Empty. Add a reference above.</p>
          ) : (
            <pre className={cn(mono, "max-h-52 min-h-28 overflow-auto p-4 text-[12.5px] leading-[1.5]")}>
              <TexSource source={added.map((p) => p.bib).join("\n\n")} language="bibtex" />
            </pre>
          )}
        </div>
      </div>
    </Window>
  );
}

/* ── 9. GitHub sync ──────────────────────────────────────────────────────── */

type Commit = { id: string; message: string; by: string };
const BASE: Commit = { id: "a1f04c2", message: "Add results section", by: "You" };
const LOCAL: Commit = { id: "b27e9d1", message: "Revise introduction", by: "You" };
const REMOTE: Commit = { id: "c3a6b88", message: "Fix typo in appendix", by: "Newton" };
const GITHUB_START = "You have one edit to push. Newton pushed one commit to GitHub.";

export function GithubDemo() {
  const [texer, setTexer] = useState<Commit[]>([BASE, LOCAL]);
  const [github, setGithub] = useState<Commit[]>([BASE, REMOTE]);
  const [note, setNote] = useState<{ text: string; tone: "info" | "ok" | "refused" }>({ text: GITHUB_START, tone: "info" });
  const unpulled = github.filter((c) => !texer.some((t) => t.id === c.id));
  const unpushed = texer.filter((c) => !github.some((g) => g.id === c.id));

  const push = () => {
    if (unpulled.length) return setNote({ text: `Push refused: GitHub has ${unpulled.length} commit you have not pulled. Pull first.`, tone: "refused" });
    if (!unpushed.length) return setNote({ text: "Nothing to push. Both sides match.", tone: "info" });
    setGithub((g) => [...g, ...unpushed]);
    setNote({ text: `Pushed ${unpushed.length} commit to GitHub.`, tone: "ok" });
  };
  const pull = () => {
    if (!unpulled.length) return setNote({ text: "Nothing to pull. You are up to date.", tone: "info" });
    setTexer((t) => [...t.filter((c) => c.id !== LOCAL.id), ...unpulled, ...t.filter((c) => c.id === LOCAL.id)]);
    setNote({ text: `Pulled ${unpulled.length} commit. Your edit is still here, ready to push.`, tone: "ok" });
  };

  // One side's history, newest at the top, each commit a dot on a line; a commit the other side lacks is marked.
  const column = (title: string, commits: Commit[], other: Commit[]) => (
    <div className="min-w-0 bg-background p-4">
      <p className="mb-3 flex items-center gap-2 type-base font-medium">
        {title}
        <span className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-mono type-small font-normal text-muted-foreground">
          <GitBranch className="size-3.5" /> main
        </span>
      </p>
      <ol className="relative flex flex-col gap-3 ps-5 before:absolute before:inset-y-2 before:start-[5px] before:w-px before:bg-line">
        {[...commits].reverse().map((c) => {
          const only = !other.some((o) => o.id === c.id);
          return (
            <li key={c.id} className="relative flex min-w-0 flex-col [animation:status-in_220ms_ease] motion-off:[animation:none]">
              <span aria-hidden className={cn("absolute -start-5 top-1.5 size-[11px] rounded-full border-2 border-background", only ? "bg-hue-amber" : "bg-muted-foreground")} />
              <span className="truncate type-base">{c.message}</span>
              <span className="flex items-center gap-2 type-small text-muted-foreground">
                <span className="font-mono">{c.id}</span>
                {c.by}
                {only && <span className="text-hue-amber">only here</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );

  return (
    <Window
      tabs={["GitHub sync"]}
      actions={
        <ResetButton
          onClick={() => {
            setTexer([BASE, LOCAL]);
            setGithub([BASE, REMOTE]);
            setNote({ text: GITHUB_START, tone: "info" });
          }}
        />
      }
      footer={
        <span role="status" className={cn("flex items-start gap-2 py-1 type-base", note.tone === "refused" ? "text-danger" : note.tone === "ok" ? "text-foreground" : "text-muted-foreground")}>
          {note.tone === "refused" && <AlertCircle className="mt-0.5 size-4 shrink-0" />}
          {note.tone === "ok" && <DrawnCheck key={note.text} className="mt-1 text-success" />}
          {note.text}
        </span>
      }
    >
      <div className="flex items-center gap-2 border-b border-line p-3">
        <span className="min-w-0 flex-1 truncate font-mono type-base text-muted-foreground">lab/paper</span>
        <Button variant="outline" onClick={pull}>
          Pull
        </Button>
        <Button onClick={push}>Push</Button>
      </div>
      <div className="grid divide-y divide-line @min-[38rem]:grid-cols-2 @min-[38rem]:divide-x @min-[38rem]:divide-y-0">
        {column("Eneles", texer, github)}
        {column("GitHub", github, texer)}
      </div>
    </Window>
  );
}

/* ── 10. Insert palette ──────────────────────────────────────────────────── */

export function PaletteDemo() {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [inserted, setInserted] = useState<string | null>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LATEX_SNIPPETS.filter((s) => !q || `${s.label} ${s.description ?? ""}`.toLowerCase().includes(q)).slice(0, 6);
  }, [query]);
  const active = results[Math.min(index, results.length - 1)];

  return (
    <Window
      tabs={["Insert"]}
      actions={
        <span className="flex items-center gap-1 pe-2">
          <Kbd>Shift</Kbd>
          <Kbd>Space</Kbd>
        </span>
      }
      footer={
        inserted ? (
          <span className="flex items-center gap-2 text-foreground">
            <DrawnCheck key={inserted} className="text-success" /> Inserted “{inserted}” at the cursor
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <Kbd>1</Kbd> to <Kbd>9</Kbd> pick
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd> insert
            </span>
          </>
        )
      }
      className="grid @min-[38rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col">
        <div className="border-b border-line p-2">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              const pick = /^[1-9]$/.test(e.key) ? results[Number(e.key) - 1] : undefined;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && active) {
                e.preventDefault();
                setInserted(active.label);
              } else if (pick && !query) {
                e.preventDefault();
                setIndex(Number(e.key) - 1);
                setInserted(pick.label);
              }
            }}
            placeholder="Search what to insert: table, matrix, figure"
            aria-label="Search snippets"
          />
        </div>
        <ul className="flex flex-col gap-0.5 p-1.5">
          {results.length === 0 && <li className="px-2.5 py-6 text-center type-base text-muted-foreground">Nothing matches.</li>}
          {results.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => setInserted(s.label)}
                data-selected={s === active || undefined}
                className="group/item flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-item)] px-2.5 py-1.5 text-start type-base transition-colors hover:bg-surface-hover/70 data-selected:bg-surface-hover"
              >
                <kbd aria-hidden className={cn(kbdClass, "w-5 px-0 tabular-nums group-data-selected/item:text-foreground")}>
                  {i + 1}
                </kbd>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.label}</span>
                  {s.description && <span className="block truncate type-small text-muted-foreground">{s.description}</span>}
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground opacity-0 group-data-selected/item:opacity-100" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-w-0 flex-col border-t border-line bg-background @min-[38rem]:border-s @min-[38rem]:border-t-0">
        <p className="flex items-center gap-1.5 border-b border-line px-4 py-2 type-small font-medium text-muted-foreground">
          <ChevronDown className="size-3.5" /> What it inserts
        </p>
        <pre className={cn(mono, "h-72 overflow-y-auto p-4 text-[12.5px] leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]")}>
          <TexSource source={active?.template ?? ""} />
        </pre>
      </div>
    </Window>
  );
}
