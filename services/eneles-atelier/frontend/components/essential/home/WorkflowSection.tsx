"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check, FileArchive, FilePlus, FileText, GitBranch, Globe, LayoutTemplate, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TexLine } from "@/components/ui/tex-code";
import { cn } from "@/lib/utils";
import { Reveal } from "./_shared";
import { HERO_PAGES } from "./hero-pages";

/*
 * From the first line to the submitted paper, in three cards drawn the way the rest of the page draws the product: each step a small, real-looking piece of the app over a few words about it, in the bento's card. They read in order (First, Then, Finally) without numbers.
 *
 * Start is the New project chooser, with the template row picked. Write and review is the jump from the PDF to the source: a line of the compiled page (the hero document, typeset by TeX) is clicked and its line in main.tex lights up. Finally is the export menu, with the push to GitHub done.
 */

function Card({ step, title, body, visual }: { step: string; title: string; body: ReactNode; visual: ReactNode }) {
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-surface)] border border-line bg-card transition-colors duration-300 hover:border-foreground/20">
      <div className="relative flex h-80 shrink-0 items-center justify-center overflow-hidden border-b border-line bg-background/60 p-6">{visual}</div>
      <div className="p-6">
        <p className="type-small font-medium text-muted-foreground">{step}</p>
        <h3 className="mt-1 type-large font-semibold tracking-[-0.01em]">{title}</h3>
        <p className="mt-2 type-base leading-relaxed text-muted-foreground text-pretty">{body}</p>
      </div>
    </div>
  );
}

/** A row of a menu or a chooser, as the app draws one. */
function Row({ icon, label, hint, picked, end }: { icon: ReactNode; label: string; hint?: string; picked?: boolean; end?: ReactNode }) {
  return (
    <div className={cn("flex min-h-10 items-center gap-2.5 rounded-[var(--radius-item)] px-2.5 type-base", picked ? "bg-surface-hover text-foreground" : "text-foreground/85")}>
      <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&>svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 type-small text-muted-foreground">{hint}</span>}
      {end}
    </div>
  );
}

function StartVisual() {
  return (
    <div className="w-full max-w-72 rounded-[var(--radius-popover)] border border-line bg-panel p-1.5 shadow-popover">
      <p className="px-2.5 pt-1.5 pb-2 type-small font-medium text-muted-foreground">New project</p>
      <Row icon={<FilePlus />} label="Blank document" />
      <Row icon={<LayoutTemplate />} label="From a template" hint="Thesis" picked />
      <Row icon={<Upload />} label="Upload a ZIP" />
      <Row icon={<Globe />} label="Import from arXiv" />
      <Row icon={<GitBranch />} label="Clone from GitHub" />
    </div>
  );
}

const SOURCE = ["\\[ \\tau \\otimes \\tau = 1 \\oplus \\tau. \\]", "Their braiding alone is dense in $SU(2)$~\\cite{freedman02}.", ""];

function ReviewVisual() {
  return (
    <div className="flex w-full max-w-80 flex-col gap-3">
      {/* A strip of the compiled page, with the clicked line marked. */}
      <div className="relative h-28 overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper shadow-lit-drop">
        {/* eslint-disable-next-line @next/next/no-img-element -- A page TeX compiled, as a static SVG. */}
        <img src={HERO_PAGES[2]} alt="" className="absolute start-[-2.25rem] top-[-10.35rem] w-[28rem] max-w-none rtl:-scale-x-100" />
        <span aria-hidden className="absolute start-[0.45rem] top-[3.35rem] h-[1.2rem] w-[12.6rem] rounded-[2px] bg-hue-blue/20 ring-1 ring-hue-blue/50" />
      </div>
      {/* The source it came from, with that line lit. */}
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-background font-mono text-[12px] leading-6">
        <div className="flex h-8 items-center gap-1.5 border-b border-line px-3 font-sans type-small text-muted-foreground">
          <FileText className="size-3.5" />
          main.tex
        </div>
        {SOURCE.map((line, i) => (
          <div key={i} className={cn("flex", i === 1 && "bg-hue-blue/12 shadow-[inset_2px_0_0_var(--hue-blue)]")}>
            <span className="w-8 shrink-0 pe-2 text-end text-muted-foreground/60 tabular-nums select-none">{18 + i}</span>
            <span className="min-w-0 flex-1 truncate pe-2">
              <TexLine text={line} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubmitVisual() {
  return (
    <div className="w-full max-w-72 rounded-[var(--radius-popover)] border border-line bg-panel p-1.5 shadow-popover">
      <p className="px-2.5 pt-1.5 pb-2 type-small font-medium text-muted-foreground">Export</p>
      <Row icon={<FileText />} label="Download the PDF" />
      <Row icon={<FileArchive />} label="Download the source" hint="ZIP" />
      <Row icon={<GitBranch />} label="Push to GitHub" picked end={<Check className="size-4 shrink-0 text-success" />} />
      <div className="mx-2.5 mt-1.5 mb-1 flex items-center gap-2 border-t border-line pt-2.5 type-small text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full bg-success" />
        <span className="min-w-0 truncate">Pushed &ldquo;Camera-ready&rdquo; to main</span>
      </div>
    </div>
  );
}

export function WorkflowSection() {
  return (
    <section aria-labelledby="workflow-title" className="py-24 @min-[40rem]:py-32">
      <div className="container">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="workflow-title" className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">
              From first draft to submitted paper.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">One project from the first line to the camera-ready PDF, with nothing to export between tools.</p>
          </div>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 @5xl:grid-cols-3">
          <Reveal className="h-full">
            <Card step="First" title="Start from anywhere" body="A blank page, a template, a ZIP, a paper on arXiv, or your GitHub repository. Photos of notes and PDF pages come in as LaTeX too." visual={<StartVisual />} />
          </Reveal>
          <Reveal delay={0.06} className="h-full">
            <Card step="Then" title="Write, and find your way back" body="Write together in code or visual mode, review with comments, and click any line of the PDF to open the source it came from." visual={<ReviewVisual />} />
          </Reveal>
          <Reveal delay={0.12} className="h-full">
            <Card step="Finally" title="Hand it in" body="The final PDF with its bibliography and index, the source as a ZIP, or a push to GitHub. It is plain .tex files the whole way." visual={<SubmitVisual />} />
          </Reveal>
        </div>

        <div className="mt-10 flex justify-center">
          <Button asChild variant="outline">
            <Link href="/docs/getting-started">
              The getting-started guide
              <ArrowRight aria-hidden className="rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
