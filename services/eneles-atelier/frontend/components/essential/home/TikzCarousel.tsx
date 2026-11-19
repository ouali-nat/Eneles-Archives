"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useMotion } from "@/hooks/useMotion";
import { getLibraryById, isPackageName } from "@/lib/tikz/libraries";
import { cn } from "@/lib/utils";
import { Reveal } from "./_shared";

/*
 * The home page's wall of figures: two rows of the Library's real renders running the full width of the window, drifting in opposite directions. They are the Library's own images (compiled by TeX from the examples), not drawings of them, with their colors as TeX drew them. In the dark theme each is its dark version (scripts/dark-preview.mjs): the ground transparent, black ink made light, colors kept. Inverting the image instead turned every plot's colors into their opposites.
 *
 * A row drifts on its own while nobody is touching it, and stops the moment the pointer is over it, it has the focus, or it is being dragged. It can be dragged with the mouse, swiped on a touch screen, scrolled with a trackpad, or stepped with the arrows; each card opens its example in the Library. The list is repeated three times and the scroll position is moved back by one copy whenever it leaves the middle one, so a row never runs out. With motion reduced or off, nothing drifts.
 */

type Pick = [library: string, example: string];

const ROW_A: Pick[] = [
  ["tikz-cd", "commutative-cube"],
  ["quantikz", "teleportation"],
  ["pgfplots", "3d-surface"],
  ["fusion-diagrams", "pentagon-equation-trees"],
  ["circuitikz", "common-emitter"],
  ["neural-networks", "transformer-encoder"],
  ["braids", "braid-vertical-colored"],
  ["chemfig", "caffeine"],
  ["automata", "markov-chain"],
  ["tikz-3dplot", "spherical-sphere"],
  ["string-diagrams", "snake-identity"],
  ["forest", "syntax-tree"],
];
const ROW_B: Pick[] = [
  ["pgfplots", "filled-contour"],
  ["knots", "trefoil"],
  ["zx-calculus", "zx-bialgebra"],
  ["flowcharts", "algorithm-flowchart"],
  ["tikz-feynman", "compton-scattering"],
  ["geometry", "inscribed-angle"],
  ["mindmap", "thesis-mindmap"],
  ["tikz-cd", "snake-lemma"],
  ["graphs", "shortest-path"],
  ["pgfgantt", "gantt-progress"],
  ["calculus", "riemann-sum"],
  ["fusion-diagrams", "hexagon-equation"],
];

type Card = { key: string; href: string; name: string; library: string; mono: boolean; src: string; dark: string | null };

function cards(picks: Pick[]): Card[] {
  return picks.flatMap(([libraryId, exampleId]) => {
    const library = getLibraryById(libraryId);
    const example = library?.examples.find((e) => e.id === exampleId);
    if (!library || !example?.preview) return [];
    return [{ key: `${libraryId}/${exampleId}`, href: `/library/${libraryId}/${exampleId}`, name: example.name, library: library.name, mono: isPackageName(library), src: example.preview, dark: example.previewDark ?? null }];
  });
}

const COPIES = 3;

function Row({ items, direction, label }: { items: Card[]; direction: 1 | -1; label: string }) {
  const track = useRef<HTMLDivElement>(null);
  const { animates } = useMotion();

  useEffect(() => {
    const el = track.current;
    if (!el || !items.length) return;
    // One copy's width: the distance between the first card of the first and of the second copy.
    const copyWidth = () => {
      const first = el.querySelector<HTMLElement>("[data-copy='0']");
      const second = el.querySelector<HTMLElement>("[data-copy='1']");
      return first && second ? second.offsetLeft - first.offsetLeft : el.scrollWidth / COPIES;
    };
    const wrap = () => {
      const w = copyWidth();
      if (el.scrollLeft < w * 0.5) el.scrollLeft += w;
      else if (el.scrollLeft > w * 1.5) el.scrollLeft -= w;
    };
    el.scrollLeft = copyWidth();

    let held = false;
    let frame = 0;
    let last = 0;
    let carry = 0;
    const speed = 28; // pixels a second
    const step = (time: number) => {
      const dt = last ? Math.min(64, time - last) : 0;
      last = time;
      if (!held && animates && document.visibilityState === "visible") {
        carry += (direction * speed * dt) / 1000;
        const whole = Math.trunc(carry);
        if (whole) {
          el.scrollLeft += whole;
          carry -= whole;
          wrap();
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    // Dragging with a mouse or a pen; touch keeps the browser's own swipe.
    let drag: { x: number; left: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      drag = { x: e.clientX, left: el.scrollLeft, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) {
        drag.moved = true;
        el.dataset.dragging = "";
      }
      el.scrollLeft = drag.left - dx;
      wrap();
    };
    const up = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      delete el.dataset.dragging;
      // A drag is not a click on the card it ended over.
      if (moved) el.addEventListener("click", (ev) => ev.preventDefault(), { capture: true, once: true });
    };
    const hold = () => (held = true);
    const release = () => {
      if (!el.matches(":hover") && !el.contains(document.activeElement)) held = false;
    };

    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("pointerenter", hold);
    el.addEventListener("pointerleave", release);
    el.addEventListener("focusin", hold);
    el.addEventListener("focusout", () => requestAnimationFrame(release));
    el.addEventListener("scroll", wrap, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("pointerenter", hold);
      el.removeEventListener("pointerleave", release);
      el.removeEventListener("scroll", wrap);
    };
  }, [items, direction, animates]);

  const nudge = (by: number) => {
    const el = track.current;
    const card = el?.querySelector<HTMLElement>("[data-card]");
    if (el && card) el.scrollBy({ left: by * (card.offsetWidth + 16), behavior: "smooth" });
  };

  return (
    <div className="group/row relative">
      <div
        ref={track}
        role="region"
        aria-label={label}
        className="flex cursor-grab gap-4 overflow-x-auto px-6 py-2 [scrollbar-width:none] data-[dragging]:cursor-grabbing data-[dragging]:select-none [&::-webkit-scrollbar]:hidden"
      >
        {Array.from({ length: COPIES }, (_, copy) =>
          items.map((card, i) => (
            <Link
              key={`${copy}-${card.key}`}
              href={card.href}
              data-card
              data-copy={i === 0 ? String(copy) : undefined}
              // Only the middle copy is reachable with the keyboard and read out; the others are there for the loop.
              tabIndex={copy === 1 ? undefined : -1}
              aria-hidden={copy === 1 ? undefined : true}
              draggable={false}
              className="group/card flex w-64 shrink-0 flex-col gap-3 rounded-[var(--radius-surface)] border border-line bg-card p-3 transition-colors hover:border-foreground/25 @min-[40rem]:w-72"
            >
              <span className={cn("relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] bg-paper", card.dark && "dark:bg-surface")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- A static render of the example: the image optimizer has nothing to do with it. */}
                <img src={card.src} alt={copy === 1 ? `${card.name}, rendered` : ""} loading="lazy" draggable={false} className={cn("absolute inset-0 size-full object-contain p-5 transition-transform duration-300 group-hover/card:scale-[1.03] motion-still:transition-none", card.dark && "dark:hidden")} />
                {card.dark && (
                  // eslint-disable-next-line @next/next/no-img-element -- The dark theme's version of the same render.
                  <img src={card.dark} alt={copy === 1 ? `${card.name}, rendered` : ""} loading="lazy" draggable={false} className="absolute inset-0 hidden size-full object-contain p-5 transition-transform duration-300 group-hover/card:scale-[1.03] motion-still:transition-none dark:block" />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 px-1 pb-0.5">
                <span className="min-w-0 truncate type-base font-medium">{card.name}</span>
                <span className={cn("min-w-0 truncate type-small text-muted-foreground", card.mono && "font-mono")}>{card.library}</span>
              </span>
            </Link>
          )),
        )}
      </div>
      {/* The edges fade into the page, and the arrows sit on them. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 start-0 w-8 @min-[40rem]:w-24 bg-linear-to-r from-background to-transparent rtl:bg-linear-to-l" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 end-0 w-8 @min-[40rem]:w-24 bg-linear-to-l from-background to-transparent rtl:bg-linear-to-r" />
      <Button variant="outline" size="icon" aria-label="Earlier figures" onClick={() => nudge(-1)} className="absolute start-4 top-1/2 -translate-y-1/2 rounded-full bg-background opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100">
        <ChevronLeft className="rtl:-scale-x-100" />
      </Button>
      <Button variant="outline" size="icon" aria-label="More figures" onClick={() => nudge(1)} className="absolute end-4 top-1/2 -translate-y-1/2 rounded-full bg-background opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100">
        <ChevronRight className="rtl:-scale-x-100" />
      </Button>
    </div>
  );
}

export function TikzCarousel() {
  const a = cards(ROW_A);
  const b = cards(ROW_B);
  return (
    <section aria-labelledby="figures-title" className="py-24 @min-[40rem]:py-32">
      <div className="container">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="figures-title" className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">
              Figures you can steal.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">
              Commutative diagrams, quantum circuits, fusion trees, plots, molecules, flowcharts. Every one of these was compiled by TeX from source you can copy, and any of them drops into your document from the editor with the packages it needs already in your preamble.
            </p>
          </div>
        </Reveal>
      </div>
      {/* The rows run the full width of the window, past the page column. */}
      <div className="mt-12 flex flex-col gap-4">
        <Row items={a} direction={1} label="Library figures, first row" />
        <Row items={b} direction={-1} label="Library figures, second row" />
      </div>
      <div className="container mt-10 flex justify-center">
        <Button asChild variant="outline">
          <Link href="/library">
            Open the library
            <ArrowRight aria-hidden className="rtl:-scale-x-100" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
