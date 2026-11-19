"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, X } from "@/components/icons";
import { TexLine } from "@/components/ui/tex-code";
import { useMotion } from "@/hooks/useMotion";
import { cn } from "@/lib/utils";
import { Reveal, SectionHeading, Tex } from "./_shared";

/**
 * The feature grid: what working on a paper here feels like, cell by cell. Each cell shows the thing itself, drawn the way the editor draws it and at the size it really is (a cursor in a paragraph, a suggestion and the comment on it, a proposal from the assistant), with a short plain explanation under it. The figures, Visual mode, and compiling have sections of their own on the page, so they are not repeated here.
 */

function Cell({ title, body, visual, className }: { title: string; body: ReactNode; visual: ReactNode; className?: string }) {
  return (
    <div className={cn("group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-surface)] border border-line bg-card transition-colors duration-300 hover:border-foreground/20", className)}>
      <div className="relative flex min-h-60 flex-1 items-center overflow-hidden border-b border-line bg-background/60 p-6">{visual}</div>
      <div className="p-6">
        <h3 className="type-large font-semibold tracking-[-0.01em]">{title}</h3>
        <p className="mt-2 type-base leading-relaxed text-muted-foreground text-pretty">{body}</p>
      </div>
    </div>
  );
}

/** A small round face in a hue, standing in for a person. */
function Face({ name, tone, className }: { name: string; tone: string; className?: string }) {
  return <span className={cn("grid size-6 shrink-0 place-items-center rounded-full type-micro font-semibold text-background", tone, className)}>{name[0]}</span>;
}

/** A named cursor, as collaborators appear in the editor; it blinks while it waits. */
function Caret({ name, tone }: { name: string; tone: string }) {
  return (
    <span className="relative inline-block h-[1.15em] w-0 align-text-bottom">
      <span className={cn("absolute inset-y-0 -start-px w-[2px] animate-caret-blink", tone)} />
      <span className={cn("absolute -top-[1.15rem] -start-px rounded-[3px] rounded-es-none px-1.5 font-sans type-micro font-medium whitespace-nowrap text-background", tone)}>{name}</span>
    </span>
  );
}

/* ── Visuals ─────────────────────────────────────────────────────────────── */

/** A paragraph of source with two people typing in it. Their words arrive a letter at a time. */
function CollabVisual() {
  const { animates } = useMotion();
  const full = ["the spectral gap", "with high probability"];
  const [shown, setShown] = useState(() => full.map((f) => f.length));
  useEffect(() => {
    if (!animates) return;
    let tick = 0;
    const timer = window.setInterval(() => {
      tick++;
      setShown(full.map((f, i) => {
        const period = f.length + 30 + i * 11;
        const at = (tick + i * 13) % period;
        return Math.min(f.length, at);
      }));
    }, 90);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animates]);
  return (
    <div className="w-full font-mono text-[14px] leading-8">
      <p>
        <TexLine text="\begin{lemma}" />
      </p>
      <p className="ps-4">
        The estimate depends only on {full[0].slice(0, shown[0])}
        <Caret name="Gauss" tone="bg-hue-blue" />
      </p>
      <p className="ps-4">
        <TexLine text="$\lambda_2$, and holds " />
        {full[1].slice(0, shown[1])}
        <Caret name="Riemann" tone="bg-hue-purple" />
      </p>
      <p>
        <TexLine text="\end{lemma}" />
      </p>
    </div>
  );
}

/** A suggested change in the text, and a comment on it. */
function ReviewVisual() {
  return (
    <div className="flex w-full flex-col gap-4">
      <p className="font-mono text-[14px] leading-8">
        The bound is <span className="text-danger line-through decoration-danger/60">loose</span>{" "}
        <span className="rounded-[2px] bg-success/15 text-success underline decoration-success/50 underline-offset-2">tight up to a constant</span> for{" "}
        <span className="rounded-[2px] bg-hue-amber/25 shadow-[inset_0_-1.5px_0_var(--hue-amber)]">all</span> <TexLine text="$n$." />
      </p>
      <div className="ms-auto flex w-[min(100%,20rem)] flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-card p-3 shadow-popover">
        <p className="flex items-center gap-2 type-base">
          <Face name="Euler" tone="bg-hue-purple" />
          <span className="font-medium">Euler</span>
          <span className="type-small text-muted-foreground">Just now</span>
        </p>
        <p className="ps-8 type-base">Is it really all of them, or only large ones?</p>
      </div>
    </div>
  );
}

/** A photo of handwriting on the left, the source it becomes on the right. */
function ConvertVisual() {
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="relative grid min-h-24 place-items-center rounded-[var(--radius-card)] border border-line bg-paper px-4 py-4 text-paper-ink shadow-lit-drop">
        <svg aria-hidden className="absolute size-0">
          <filter id="bento-hand">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="4" />
          </filter>
        </svg>
        <span className="-rotate-2 [filter:url(#bento-hand)] [&_.katex]:text-[1.35rem]">
          <Tex>{"\\oint_C \\mathbf{F}\\cdot d\\mathbf{r} = \\iint_S (\\nabla\\times\\mathbf{F})\\cdot d\\mathbf{S}"}</Tex>
        </span>
      </div>
      <code className="block rounded-[var(--radius-card)] border border-line bg-background px-3 py-2.5 font-mono text-[13px] leading-6 [overflow-wrap:anywhere]">
        <TexLine text="\oint_C \mathbf{F}\cdot d\mathbf{r} = \iint_S (\nabla\times\mathbf{F})\cdot d\mathbf{S}" />
      </code>
    </div>
  );
}

/** What the assistant was asked, and the change it proposes, waiting for an answer. */
function AxyaVisual() {
  const lines: [string, "same" | "del" | "add"][] = [
    ["\\begin{align}", "same"],
    ["  E = mc^2", "del"],
    ["  E^2 = (mc^2)^2 + (pc)^2", "add"],
    ["\\end{align}", "same"],
  ];
  return (
    <div className="flex w-full flex-col gap-3">
      <p className="ms-auto max-w-[85%] rounded-[var(--radius-card)] bg-surface px-3 py-2 type-base">Add the momentum term to the energy equation</p>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
        <div className="flex min-h-11 items-center gap-2 py-1 ps-3 pe-1.5 type-base">
          <span className="font-medium">main.tex</span>
          <span className="type-small tabular-nums text-success">+1</span>
          <span className="type-small tabular-nums text-danger">−1</span>
          <span className="ms-auto flex items-center gap-1.5">
            <span className="flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-line px-3 type-small font-medium text-muted-foreground">
              <X className="size-3.5" /> Reject
            </span>
            <span className="flex h-8 items-center gap-1.5 rounded-[var(--radius)] bg-accent px-3 type-small font-medium text-on-accent">
              <Check className="size-3.5" /> Accept
            </span>
          </span>
        </div>
        <div className="border-t border-line bg-background font-mono text-[13px] leading-7">
          {lines.map(([text, kind], i) => (
            <div key={i} className={cn("flex gap-2 px-3", kind === "add" && "bg-success/10", kind === "del" && "bg-danger/10")}>
              <span aria-hidden className={cn("w-3 select-none", kind === "add" ? "text-success" : kind === "del" ? "text-danger" : "text-transparent")}>
                {kind === "add" ? "+" : kind === "del" ? "−" : " "}
              </span>
              <span className="truncate">
                <TexLine text={text} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Two histories that meet: Eneles's and GitHub's. */
function GitVisual() {
  const row = (side: "eneles" | "github", message: string, who: string) => (
    <li className="relative flex items-center gap-3 type-base">
      <span aria-hidden className={cn("absolute size-[11px] rounded-full border-2 border-background", side === "eneles" ? "-start-[1.65rem] bg-foreground" : "-start-[1.65rem] bg-hue-amber")} />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <span className="shrink-0 type-small text-muted-foreground">{who}</span>
    </li>
  );
  return (
    <div className="w-full">
      <ol className="relative flex flex-col gap-3.5 ps-7 before:absolute before:inset-y-1.5 before:start-[5px] before:w-px before:bg-line">
        {row("github", "Fix typo in appendix", "Newton on GitHub")}
        {row("eneles", "Revise introduction", "You in Eneles")}
        {row("eneles", "Add results figure", "Euclid in Eneles")}
      </ol>
      <p className="mt-5 flex items-center gap-2 type-small text-muted-foreground">
        <span className="size-2 rounded-full bg-hue-amber" /> Pulled in before your push, so nobody&rsquo;s work is lost.
      </p>
    </div>
  );
}

/** A file's recent versions, by the people who made them. */
function HistoryVisual() {
  const rows: [string, string, string, string][] = [
    ["Ibn Sina", "bg-hue-blue", "chapters/results.tex", "A few minutes ago"],
    ["You", "bg-foreground", "main.tex", "This morning"],
    ["Al-Khwarizmi", "bg-hue-purple", "references.bib", "Yesterday"],
  ];
  return (
    <ul className="flex w-full flex-col gap-1">
      {rows.map(([name, tone, file, when], i) => (
        <li key={file} className={cn("flex min-h-12 items-center gap-3 rounded-[var(--radius-card)] px-3", i === 0 && "bg-surface")}>
          <Face name={name} tone={tone} />
          <span className="min-w-0 flex-1">
            <span className="block truncate type-base font-medium">{file}</span>
            <span className="block truncate type-small text-muted-foreground">
              {name} · {when}
            </span>
          </span>
          {i === 0 && <span className="shrink-0 rounded-[var(--radius)] border border-line px-2.5 py-1 type-small font-medium">Restore</span>}
        </li>
      ))}
    </ul>
  );
}

/** Lessons, the way the Learn section lists them. */
function LearnVisual() {
  const lessons: [string, string][] = [
    ["Aligning equations", "Line equations up at a relation and break long ones."],
    ["Theorems and proofs", "Numbered theorems, lemmas, and proofs that end in a box."],
  ];
  return (
    <div className="flex w-full flex-col gap-2.5">
      {lessons.map(([title, body], i) => (
        <div key={title} className={cn("rounded-[var(--radius-card)] border border-line bg-card p-3.5", i === 1 && "ms-6 opacity-80")}>
          <p className="type-base font-semibold">{title}</p>
          <p className="mt-0.5 type-small text-muted-foreground">{body}</p>
        </div>
      ))}
    </div>
  );
}

/* ── Section ─────────────────────────────────────────────────────────────── */

export function BentoSection() {
  return (
    <section id="features" className="py-24 @min-[40rem]:py-32">
      <div className="container">
        <Reveal>
          <SectionHeading title="Built for the way papers actually get written" lede="Several people, one file, comments flying, a deadline. This is the editor for that." />
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 @5xl:grid-cols-3">
          <Reveal className="@5xl:col-span-2">
            <Cell title="Your co-authors, in the same paragraph" body="Everyone types into the same file at the same time. You see where each person is, with their name on their cursor, and nobody's sentence overwrites anyone else's." visual={<CollabVisual />} />
          </Reveal>
          <Reveal delay={0.06}>
            <Cell title="Suggest, don't overwrite" body="Select a passage and propose a rewrite. Your co-authors accept it or reject it, and comments stay pinned to their words as the text moves around them." visual={<ReviewVisual />} />
          </Reveal>
          <Reveal delay={0.06}>
            <Cell title="Snap your notes into LaTeX" body="Photograph a whiteboard, a notebook page, or a screenshot of an equation, and get source you can paste straight into your document. PDFs work too." visual={<ConvertVisual />} />
          </Reveal>
          <Reveal className="@5xl:col-span-2" delay={0.12}>
            <Cell title="An assistant that asks before it touches anything" body="Ask Axya to fix a compile error, tighten a proof, or build a table from a description. It reads your project and proposes the change as a diff. Nothing moves until you accept it." visual={<AxyaVisual />} />
          </Reveal>
          <Reveal delay={0.18}>
            <Cell title="GitHub, both ways" body="Link a repository and push or pull whenever you like. If someone pushed while you were writing, Eneles has you pull first, so nothing gets clobbered." visual={<GitVisual />} />
          </Reveal>
          <Reveal delay={0.18}>
            <Cell title="Every version, kept" body="The whole project's history, with who changed what and when, narrowed to one file or one person if you like. Compare any version with today and bring it back in one click." visual={<HistoryVisual />} />
          </Reveal>
          <Reveal delay={0.18}>
            <Cell title="Stuck? It's explained" body="Short lessons for every corner of LaTeX, from your first document to fusion trees, each with examples compiled right on the page." visual={<LearnVisual />} />
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <p className="mt-10 text-center">
            <Link href="/features" className="group inline-flex h-[var(--control-height)] items-center gap-1.5 type-base font-medium underline-offset-4 hover:underline">
              Try each of these for yourself
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
