"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check } from "@/components/icons";
import { EmberGlow } from "@/components/essential/shaders/EmberGlow";
import { CrumpledPaperReveal } from "@/components/motion/CrumpledPaperReveal";
import { Avatar } from "@/components/people/Avatar";
import { Button } from "@/components/ui/button";
import { useMotion } from "@/hooks/useMotion";
import { cn } from "@/lib/utils";
import { Reveal } from "./_shared";
import { HERO_PAGES } from "./hero-pages";

/*
 * The closing call to action: one stage across the page column, the last thing before the footer.
 *
 * Behind it, one shader (EmberGlow): a slow orange glow that rises behind the pages and warms where the pointer is. On the left, the headline, a `\title{...}` line that keeps starting new papers (it types a title, holds it, and erases it), the two ways in, and what is promised. On the right, a fanned stack of real pages TeX compiled: two pages of the fusion package's manual (public/cta, scripts/cta-pages.sh) behind, and in front the hero's paper (its last page in hero-pages.ts), which arrives crumpled into a ball and opens out flat, creases and all, once the stage is in view (CrumpledPaperReveal). The stack leans toward the pointer and spreads while the pointer is over the stage, and two pieces of the app float over it (who is writing with you, and a PDF that has just compiled), drifting a little further than the pages so the stack has depth.
 *
 * With motion reduced the title stands still on the first one, and nothing leans, spreads, or follows the pointer.
 */

const TITLES = ["Braiding Fibonacci anyons", "Notes on modular tensor categories", "The geometry of the Riemann sphere", "Lectures on quantum field theory", "My thesis, finally"];

/** Who is writing with you: the hero paper's authors, faces drawn as everywhere in the app. */
const WRITERS = [
  { id: 7101, name: "Michael Atiyah" },
  { id: 7102, name: "Henri Poincaré" },
  { id: 7103, name: "Richard Feynman" },
];

const PROMISES = ["Unlimited projects and collaborators", "No card, no trial countdown", "Plain .tex files, yours to take anywhere", "Never used to train models"];

/** The \title line: types a title, holds it, erases it, and goes on to the next. */
function TypedTitle() {
  const { animates } = useMotion();
  const [state, setState] = useState({ title: 0, length: TITLES[0].length });
  useEffect(() => {
    if (!animates) return;
    let title = 0;
    let length = TITLES[0].length;
    let phase: "hold" | "erase" | "type" = "hold";
    let wait = 2200;
    let timer = 0;
    const tick = () => {
      if (phase === "hold") phase = "erase";
      else if (phase === "erase") {
        length--;
        if (length <= 0) {
          title = (title + 1) % TITLES.length;
          phase = "type";
        }
      } else {
        length++;
        if (length >= TITLES[title].length) phase = "hold";
      }
      setState({ title, length });
      wait = phase === "hold" ? 2200 : phase === "erase" ? 28 : 55 + Math.random() * 45;
      timer = window.setTimeout(tick, wait);
    };
    timer = window.setTimeout(tick, wait);
    return () => window.clearTimeout(timer);
  }, [animates]);
  const text = TITLES[state.title].slice(0, state.length);
  return (
    <p aria-hidden className="inline-flex w-[min(100%,25rem)] items-center rounded-[var(--radius)] border border-line bg-background/70 px-3.5 py-2 font-mono text-[14px] backdrop-blur-sm @min-[40rem]:text-[15px]">
      <span className="text-hue-blue">\title</span>
      <span className="text-muted-foreground">{"{"}</span>
      <span className="min-w-0 truncate text-foreground">{text}</span>
      <span className="ms-px inline-block h-[1.1em] w-0.5 shrink-0 animate-caret-blink bg-foreground" />
      <span className="text-muted-foreground">{"}"}</span>
    </p>
  );
}

/** One page in the stack: a sheet of paper with a page TeX compiled on it. */
function Sheet({ src, alt, className, style }: { src: string; alt: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("absolute top-1/2 left-1/2 aspect-[210/297] w-[58%] max-w-[19rem] overflow-hidden rounded-[3px] bg-paper shadow-[0_1px_0_rgb(0_0_0/0.04),0_24px_60px_-12px_rgb(0_0_0/0.45)] ring-1 ring-line transition-transform duration-500 ease-[var(--motion-ease)] motion-still:transition-none", className)} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element -- A page TeX compiled, shown as it is. */}
      <img src={src} alt={alt} loading="lazy" draggable={false} className="size-full object-cover object-top" />
    </div>
  );
}

export function CTASection() {
  const stage = useRef<HTMLDivElement>(null);
  const { animates } = useMotion();
  const [over, setOver] = useState(false);

  // The pointer, as a share of the stage from its center (-1 to 1 each way), written to the stage's style so nothing re-renders as it moves.
  useEffect(() => {
    const el = stage.current;
    if (!el || !animates) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--px", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
        el.style.setProperty("--py", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
              });
    };
    el.addEventListener("pointermove", move);
    return () => {
      el.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [animates]);

  const spread = over && animates;

  return (
    <section aria-labelledby="cta-title" className="py-24 @min-[40rem]:py-32">
      <div className="container">
        <Reveal>
          <div
            ref={stage}
            onPointerEnter={() => setOver(true)}
            onPointerLeave={() => setOver(false)}
            style={{ "--px": 0, "--py": 0 } as CSSProperties}
            className="relative isolate overflow-hidden rounded-[calc(var(--radius-surface)*1.5)] border border-line bg-card shadow-lit-drop"
          >
            {/* One ground: a slow orange glow that rises behind the pages and warms where the pointer is. */}
            <div aria-hidden className="absolute inset-0 -z-10">
              <EmberGlow className="size-full" />
            </div>

            <div className="grid items-center gap-10 p-8 @min-[40rem]:p-12 @5xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] @5xl:gap-6 @5xl:p-16">
              <div className="flex min-w-0 flex-col items-start">
                <TypedTitle />
                <h2 id="cta-title" className="mt-7 text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance @min-[40rem]:text-6xl @5xl:text-[4.25rem]">
                  Start your next paper here.
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty @min-[40rem]:text-xl">Open a blank page or a template, invite whoever is writing it with you, and have a PDF in a minute. Everything on this page is in the free plan.</p>

                <div className="mt-9 flex w-full flex-col gap-3 @min-[40rem]:w-auto @min-[40rem]:flex-row">
                  <Button asChild size="lg" className="group/cta">
                    <Link href="/signup">
                      Create a free account
                      <ArrowRight aria-hidden className="transition-transform duration-200 group-hover/cta:translate-x-0.5 rtl:-scale-x-100" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="bg-background/60 backdrop-blur-sm">
                    <Link href="/features">Try the features first</Link>
                  </Button>
                </div>

                <ul className="mt-9 grid w-full gap-x-6 gap-y-3 @min-[40rem]:grid-cols-2">
                  {PROMISES.map((promise) => (
                    <li key={promise} className="flex items-center gap-2.5 type-base text-foreground/85">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                        <Check className="size-3.5" />
                      </span>
                      {promise}
                    </li>
                  ))}
                </ul>
              </div>

              {/* The stack of pages, leaning toward the pointer and spreading while it is over the stage. */}
              <div aria-hidden className="relative h-[24rem] [perspective:1400px] @min-[40rem]:h-[30rem] @5xl:h-[34rem]">
                <div className="absolute inset-0 transition-transform duration-300 ease-out [transform-style:preserve-3d] motion-still:transition-none" style={{ transform: animates ? "rotateY(calc(var(--px) * 9deg)) rotateX(calc(var(--py) * -7deg))" : undefined }}>
                  <Sheet src="/cta/fusion-manual-18.png" alt="" style={{ transform: `translate(-50%, -50%) translate(${spread ? "-44%" : "-32%"}, ${spread ? "5%" : "4%"}) rotate(${spread ? -11 : -8}deg)` }} />
                  <Sheet src="/cta/fusion-manual-16.png" alt="" style={{ transform: `translate(-50%, -50%) translate(${spread ? "46%" : "32%"}, ${spread ? "4%" : "3%"}) rotate(${spread ? 10 : 7}deg)` }} />
                  {/* The front page arrives crumpled, a ball of a draft, and opens out flat into the paper once the stage is in view. */}
                  <div className="absolute top-1/2 left-1/2 w-[62%] max-w-[19rem] transition-transform duration-500 ease-[var(--motion-ease)] motion-still:transition-none" style={{ transform: `translate(-50%, -50%) translateY(${spread ? "-5%" : "-2%"}) rotate(${spread ? -1 : 0}deg) scale(${spread ? 1.03 : 1})` }}>
                    <CrumpledPaperReveal trigger="in-view" ratio="a4" paper="page" label="Braiding Fibonacci anyons, compiled" creases={0.5} className="[--crumple-pad:0px]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- A page TeX compiled, shown as it is. */}
                      <img src={HERO_PAGES[2]} alt="" draggable={false} className="block size-full object-cover object-top" />
                    </CrumpledPaperReveal>
                  </div>
                </div>
                {/* Two pieces of the app over the pages, drifting a little further than the pages as the pointer moves, so the stack has depth. */}
                <div className="pointer-events-none absolute start-[2%] top-[9%] flex items-center gap-2.5 rounded-full border border-line bg-panel/90 py-1.5 ps-1.5 pe-3.5 shadow-popover backdrop-blur-md transition-transform duration-300 ease-out motion-still:transition-none @5xl:start-[-4%]" style={{ transform: animates ? "translate(calc(var(--px) * -14px), calc(var(--py) * -10px))" : undefined }}>
                  <span className="flex -space-x-1.5">
                    {WRITERS.map((w) => (
                      <Avatar key={w.id} person={w} size="sm" decorative className="ring-2 ring-panel" />
                    ))}
                  </span>
                  <span className="type-small font-medium whitespace-nowrap">Writing with you</span>
                </div>
                <div className="pointer-events-none absolute end-[2%] bottom-[10%] flex items-center gap-2 rounded-full border border-line bg-panel/90 py-2 ps-2.5 pe-3.5 shadow-popover backdrop-blur-md transition-transform duration-300 ease-out motion-still:transition-none @5xl:end-[-3%]" style={{ transform: animates ? "translate(calc(var(--px) * 16px), calc(var(--py) * 12px))" : undefined }}>
                  <span className="grid size-5 place-items-center rounded-full bg-success/15 text-success">
                    <Check className="size-3.5" />
                  </span>
                  <span className="type-small font-medium whitespace-nowrap">PDF ready</span>
                  <span className="type-small whitespace-nowrap text-muted-foreground">main.tex</span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
