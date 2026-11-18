"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import { useMotion } from "@/hooks/useMotion";
import "katex/dist/katex.min.css";

/*
 * The wordmark across the foot of the site, set the way TeX sets its own logo: T, a lowered E, X, a lowered E, R, pulled together by negative kerns. It runs edge to edge and fades toward the bottom of the page, like a mat at the door.
 *
 * - A soft light follows the pointer across the letters.
 * - Hovering a letter shows how TeX sees it: its box, its baseline, and its reference point. One letter at a time, so the word stays readable.
 * - Under full motion the letters arrive unset, side by side on one baseline, and settle into place once, when the mat first scrolls into view. Otherwise the word is shown set.
 *
 * Decorative: the footer names the product in text. Units are thousandths of an em of Computer Modern Roman 10pt (cmr10).
 */
const CAP = 683; // height of a capital
const DROP = 215; // half an ex: \lower.5ex
const LETTERS = [
  { ch: "T", w: 722, kern: -167, low: false },
  { ch: "E", w: 681, kern: -125, low: true },
  { ch: "X", w: 750, kern: -167, low: false },
  { ch: "E", w: 681, kern: -125, low: true },
  { ch: "R", w: 736, kern: 0, low: false },
];

const layout = (() => {
  let set = 0;
  let loose = 0;
  const gap = 70;
  const rows = LETTERS.map((l) => {
    const row = { ...l, x: set, looseX: loose };
    set += l.w + l.kern;
    loose += l.w + gap;
    return row;
  });
  const width = set;
  const shift = (loose - gap - width) / 2;
  return { width, rows: rows.map((r) => ({ ...r, dx: r.looseX - shift - r.x })) };
})();

const PAD = 60;
const TOP = -CAP - 40;
const HEIGHT = CAP + DROP + 40;
const VIEW = `${-PAD} ${TOP} ${layout.width + 2 * PAD} ${HEIGHT}`;
const FONT = "[font-family:KaTeX_Main,'Latin_Modern_Roman',Georgia,serif] text-[1000px]";

export function WelcomeMat() {
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const spot = useRef<SVGCircleElement>(null);
  const { animates } = useMotion();
  const id = useId().replace(/:/g, "");

  // The letters settle when the mat comes into view.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!animates) {
      el.dataset.state = "set";
      return;
    }
    let raf = 0;
    const settle = () => {
      el.dataset.instant = "";
      el.dataset.state = "loose";
      void el.offsetWidth;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        delete el.dataset.instant;
        el.dataset.state = "set";
      });
    };
    el.dataset.instant = "";
    el.dataset.state = "loose";
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          settle();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [animates]);

  // The light under the pointer, positioned in the drawing's own units.
  useEffect(() => {
    const el = root.current;
    const drawing = svg.current;
    const circle = spot.current;
    if (!el || !drawing || !circle) return;
    const move = (e: PointerEvent) => {
      const matrix = drawing.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
      circle.setAttribute("cx", String(point.x));
      circle.setAttribute("cy", String(point.y));
      el.dataset.lit = "";
    };
    const leave = () => delete el.dataset.lit;
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);

  const hairline = "fill-none stroke-[color-mix(in_oklab,var(--foreground)_35%,transparent)] [stroke-width:1px] [vector-effect:non-scaling-stroke]";

  return (
    <div ref={root} aria-hidden data-state="set" className="welcome-mat group/mat relative w-full select-none overflow-hidden">
      <svg ref={svg} viewBox={VIEW} preserveAspectRatio="xMidYMax meet" className="block h-auto w-full">
        <defs>
          {/* The word fades out toward the bottom edge of the page. */}
          <linearGradient id={`${id}-fade`} x1="0" y1={TOP} x2="0" y2={TOP + HEIGHT} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="white" stopOpacity="1" />
            <stop offset="0.55" stopColor="white" stopOpacity="0.85" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={`${id}-fade-mask`} maskUnits="userSpaceOnUse" x={-PAD} y={TOP} width={layout.width + 2 * PAD} height={HEIGHT}>
            <rect x={-PAD} y={TOP} width={layout.width + 2 * PAD} height={HEIGHT} fill={`url(#${id}-fade)`} />
          </mask>
          <radialGradient id={`${id}-spot`}>
            <stop offset="0" stopColor="white" stopOpacity="1" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id={`${id}-spot-mask`} maskUnits="userSpaceOnUse" x={-PAD} y={TOP} width={layout.width + 2 * PAD} height={HEIGHT}>
            <circle ref={spot} cx={-9999} cy={0} r={700} fill={`url(#${id}-spot)`} />
          </mask>
        </defs>

        <g mask={`url(#${id}-fade-mask)`}>
          {layout.rows.map((r, i) => {
            const base = r.low ? DROP : 0;
            return (
              <g
                key={i}
                style={{ "--dx": `${r.dx}px`, "--dy": `${r.low ? -DROP : 0}px`, "--i": i } as CSSProperties}
                className="group/box [transition:transform_1000ms_cubic-bezier(0.2,0.9,0.25,1)_calc(var(--i)*70ms)] group-data-[state=loose]/mat:[transform:translate(var(--dx),var(--dy))] group-data-[instant]/mat:[transition:none]"
              >
                {/* The letter. */}
                <text x={r.x} y={base} className={`${FONT} fill-[color-mix(in_oklab,var(--foreground)_10%,var(--background))]`}>
                  {r.ch}
                </text>
                {/* The light under the pointer, drawn over the letter and masked to a soft circle. */}
                <text x={r.x} y={base} mask={`url(#${id}-spot-mask)`} className={`${FONT} fill-[color-mix(in_oklab,var(--foreground)_32%,var(--background))] opacity-0 transition-opacity duration-500 group-data-[lit]/mat:opacity-100`}>
                  {r.ch}
                </text>
                {/* How TeX sees this letter, on hover: its box, its baseline, its reference point. */}
                <g className="opacity-0 transition-opacity duration-300 group-hover/box:opacity-100">
                  <rect x={r.x} y={base - CAP} width={r.w} height={CAP} className={hairline} />
                  <line x1={r.x - 40} x2={r.x + r.w + 40} y1={base} y2={base} className={`${hairline} [stroke-dasharray:4_4]`} />
                  <circle cx={r.x} cy={base} r={9} className="fill-[color-mix(in_oklab,var(--foreground)_60%,transparent)]" />
                </g>
                {/* Hover target: the letter's box, so the gaps between glyph strokes still count. */}
                <rect x={r.x} y={base - CAP} width={r.w + r.kern} height={CAP} className="fill-transparent" />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
