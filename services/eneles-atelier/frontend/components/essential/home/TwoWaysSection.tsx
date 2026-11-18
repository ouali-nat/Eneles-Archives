"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TexLine } from "@/components/ui/tex-code";
import { useMotion } from "@/hooks/useMotion";
import { Reveal, Tex } from "./_shared";

/*
 * "Same file, two ways": one passage of a paper, as source on one side and as Visual mode draws it on the other, side by side the way the editor can show them, with the divider between them draggable. It runs wider than the page column, nearly edge to edge, so both sides have room to read.
 *
 * Each side reflows into the room it has, so both stay readable wherever the divider is: drag it toward one side to give the other more space. The divider can be dragged and moved with the arrow keys (it is a slider to assistive technology); the text on both sides stays selectable. With full motion it eases a little each way once when the section comes into view, to show that it moves. On a phone the two sides are stacked instead.
 */

const SOURCE = [
  "\\section{Spectral embeddings}",
  "\\label{sec:spectral}",
  "",
  "Let $G$ be a graph on $n$ vertices with",
  "normalized Laplacian $\\mathcal{L}$, and let",
  "$0 = \\lambda_1 \\le \\dots \\le \\lambda_n$ be its",
  "eigenvalues~\\cite{chung97}.",
  "",
  "\\begin{theorem}[Cheeger]",
  "  \\label{thm:cheeger}",
  "  For every graph,",
  "  \\begin{equation}",
  "    \\frac{\\lambda_2}{2} \\le h(G) \\le \\sqrt{2\\lambda_2}.",
  "  \\end{equation}",
  "\\end{theorem}",
  "",
  "By Theorem~\\ref{thm:cheeger}, a small $\\lambda_2$",
  "means the graph has a sparse cut.",
];

/** The passage as Visual mode draws it: numbered heading, the theorem in its frame, the equation set and numbered, the citation as a chip, the reference resolved. */
function Typeset() {
  const chip = (children: ReactNode) => <span className="mx-0.5 rounded-[var(--radius-inset)] border border-hue-teal/40 bg-hue-teal/10 px-1.5 py-px align-[0.08em] font-sans text-[13px] text-hue-teal">{children}</span>;
  return (
    <div className="mx-auto max-w-[44rem] px-6 pt-16 pb-10 text-[18px] leading-[1.8] @min-[48rem]:px-12 @min-[48rem]:text-[20px] [font-family:KaTeX_Main,'Times_New_Roman',serif]">
      <h3 className="text-[1.75rem] leading-tight font-bold">
        <span className="me-4">2</span>Spectral embeddings
      </h3>
      <p className="mt-5">
        Let <Tex>{"G"}</Tex> be a graph on <Tex>{"n"}</Tex> vertices with normalized Laplacian <Tex>{"\\mathcal{L}"}</Tex>, and let <Tex>{"0 = \\lambda_1 \\le \\dots \\le \\lambda_n"}</Tex> be its eigenvalues {chip("chung97")}.
      </p>
      <div className="mt-5 border-s-2 border-hue-purple/60 ps-5">
        <p>
          <span className="font-bold">Theorem 2.1</span> (Cheeger)<span className="font-bold">.</span> <span className="italic">For every graph,</span>
        </p>
        <div className="my-2 flex items-center">
          <span className="flex-1 text-center">
            <Tex>{"\\frac{\\lambda_2}{2} \\le h(G) \\le \\sqrt{2\\lambda_2}."}</Tex>
          </span>
          <span>(2.1)</span>
        </div>
      </div>
      <p className="mt-5">
        By Theorem 2.1, a small <Tex>{"\\lambda_2"}</Tex> means the graph has a sparse cut.
      </p>
    </div>
  );
}

function SourceView() {
  return (
    <div className="px-6 pt-16 pb-10 font-mono text-[14px] leading-[1.9] @min-[48rem]:px-10 @min-[48rem]:text-[15px]">
      {SOURCE.map((line, i) => (
        <div key={i} className="flex">
          <span className="w-9 shrink-0 pe-4 text-end text-muted-foreground/50 tabular-nums select-none">{i + 1}</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap">
            <TexLine text={line} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function TwoWaysSection() {
  const { animates } = useMotion();
  const panel = useRef<HTMLDivElement>(null);
  // Where the divider is, as a share of the panel's width from the start edge.
  const [split, setSplit] = useState(0.5);
  const dragging = useRef(false);

  const place = useCallback((clientX: number) => {
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    const rtl = getComputedStyle(panel.current!).direction === "rtl";
    const share = (clientX - rect.left) / rect.width;
    setSplit(Math.min(0.8, Math.max(0.2, rtl ? 1 - share : share)));
  }, []);

  // The divider eases across once when the section comes into view, to show that it moves.
  useEffect(() => {
    const el = panel.current;
    if (!el || !animates) return;
    let frame = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const start = performance.now();
        const run = (now: number) => {
          if (dragging.current) return;
          const t = Math.min(1, (now - start) / 2400);
          // A little each way, and settle in the middle.
          const ease = 0.5 - 0.12 * Math.sin(t * Math.PI * 2) * (1 - t);
          setSplit(ease);
          if (t < 1) frame = requestAnimationFrame(run);
        };
        frame = requestAnimationFrame(run);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [animates]);

  useEffect(() => {
    const move = (e: PointerEvent) => dragging.current && place(e.clientX);
    const up = () => (dragging.current = false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [place]);

  const percent = Math.round(split * 100);

  return (
    <section aria-labelledby="two-ways-title" className="py-24 @min-[40rem]:py-32">
      <div className="container">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="two-ways-title" className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">
              Write it in source. Read it like a paper.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">
              The file is always plain LaTeX. Flip to Visual mode and the same lines read the way they will print: headings numbered, equations set, references resolved, citations as chips. Drag the divider to give either side more room.
            </p>
          </div>
        </Reveal>
      </div>

      {/* Wider than the page column: nearly edge to edge. */}
      <Reveal className="mx-auto mt-12 w-full max-w-[100rem] px-4 @min-[40rem]:px-8">
        <div
          ref={panel}
          className="relative isolate touch-pan-y overflow-hidden @min-[48rem]:h-[40rem] @min-[48rem]:select-none rounded-[var(--radius-surface)] border border-line bg-background shadow-lit-drop"
          onPointerDown={(e) => {
            // Only the divider starts a drag, so the text on either side can still be selected and read.
            if (e.button !== 0 || !(e.target as HTMLElement).closest("[data-divider]")) return;
            e.preventDefault();
            dragging.current = true;
          }}
        >
          {/* Code, then the page: stacked on a phone, side by side from a tablet up, with the divider between them. */}
          <div className="flex flex-col @min-[48rem]:h-full @min-[48rem]:flex-row">
            <div className="relative min-h-0 overflow-hidden border-b border-line bg-background @min-[48rem]:w-[var(--split)] @min-[48rem]:flex-none @min-[48rem]:border-b-0" style={{ "--split": `${percent}%` } as React.CSSProperties}>
              <span className="pointer-events-none absolute start-4 top-4 z-10 rounded-full border border-line bg-background/85 px-3 py-1 type-small font-medium backdrop-blur">Code</span>
              <SourceView />
            </div>
            <div className="relative min-h-0 overflow-hidden bg-card @min-[48rem]:flex-1">
              <span className="pointer-events-none absolute end-4 top-4 z-10 rounded-full border border-line bg-card/85 px-3 py-1 type-small font-medium backdrop-blur">Visual</span>
              <Typeset />
            </div>
          </div>

          {/* The divider. */}
          <div className="absolute inset-y-0 hidden w-0 start-[var(--split)] @min-[48rem]:block" style={{ "--split": `${percent}%` } as React.CSSProperties}>
            <span aria-hidden className="absolute inset-y-0 -start-px w-px bg-line" />
            <div
              data-divider
              role="slider"
              tabIndex={0}
              aria-label="Divider between code and visual"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`Code takes ${percent} percent of the width`}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.1 : 0.03;
                if (e.key === "ArrowLeft") setSplit((s) => Math.max(0.2, s - step));
                else if (e.key === "ArrowRight") setSplit((s) => Math.min(0.8, s + step));
                else if (e.key === "Home") setSplit(0.2);
                else if (e.key === "End") setSplit(0.8);
                else return;
                e.preventDefault();
              }}
              className="absolute top-1/2 -start-5 grid size-10 -translate-y-1/2 cursor-ew-resize touch-none place-items-center rounded-full border border-line bg-background text-foreground shadow-popover outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="flex items-center">
                <ChevronLeft className="-me-1 size-4" />
                <ChevronRight className="-ms-1 size-4" />
              </span>
            </div>
          </div>
        </div>
      </Reveal>

      <div className="container mt-8 flex justify-center">
        <Button asChild variant="outline">
          <Link href="/docs/visual-mode">
            How Visual mode works
            <ArrowRight aria-hidden className="rtl:-scale-x-100" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
