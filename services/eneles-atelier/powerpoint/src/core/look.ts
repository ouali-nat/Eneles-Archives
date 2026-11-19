// The global Look: slide preset, ink, paper and font.
//
// One set of colours for every workspace. Earlier builds tied the ink to the
// task pane's own light/dark theme and applied it only in the Math tab, so
// TikZ and boxes were always black and flipping the pane theme silently
// recoloured equations. The Look is about the *slide*, never the pane.
//
// Keep this in step with impress/python/pythonpath/texer_imp/look.py.

import { FontId, SlidePreset } from "./types";

export const PRESETS: Record<Exclude<SlidePreset, "custom">, { ink: string; paper: string }> = {
  light: { ink: "#171717", paper: "#FFFFFF" },
  dark: { ink: "#F5F5F5", paper: "#1F1F1F" },
};

export const PRESET_LABELS: { id: SlidePreset; label: string }[] = [
  { id: "light", label: "Light slide" },
  { id: "dark", label: "Dark slide" },
  { id: "custom", label: "Custom" },
];

export const FONTS: { id: FontId; label: string; lines: string[] }[] = [
  { id: "cm", label: "Computer Modern (default)", lines: [] },
  { id: "lm", label: "Latin Modern", lines: ["\\usepackage[T1]{fontenc}", "\\usepackage{lmodern}"] },
  { id: "palatino", label: "Palatino", lines: ["\\usepackage{newpxtext,newpxmath}"] },
  { id: "times", label: "Times", lines: ["\\usepackage{newtxtext,newtxmath}"] },
  { id: "libertine", label: "Libertine", lines: ["\\usepackage{libertine}", "\\usepackage[libertine]{newtxmath}"] },
  { id: "sans", label: "Sans serif", lines: ["\\usepackage{sansmathfonts}", "\\renewcommand{\\familydefault}{\\sfdefault}"] },
  { id: "system", label: "System font (XeLaTeX)", lines: [] },
];

export function normalizeHex(value: string | undefined | null, fallback = ""): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((value || "").trim());
  return m ? m[1].toUpperCase() : fallback;
}

function rgb(hex6: string): [number, number, number] {
  return [0, 2, 4].map((i) => parseInt(hex6.slice(i, i + 2), 16)) as [number, number, number];
}

/** `a` moved `weight` of the way toward `b`. Hex in, 6-digit hex out. */
export function mix(a: string, b: string, weight: number): string {
  const ra = rgb(normalizeHex(a, "000000"));
  const rb = rgb(normalizeHex(b, "FFFFFF"));
  return ra
    .map((x, i) => Math.round(x + (rb[i] - x) * weight).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function luminance(hex: string): number {
  const ch = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(normalizeHex(hex, "000000")).map(ch);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.18;
}

/**
 * `color` nudged toward white or black until it reads on `paper`. A navy
 * theorem accent is fine on a white slide and invisible on a dark one; this
 * keeps the hue and fixes the contrast.
 */
export function readableOn(color: string, paper: string, minimum = 3): string {
  const target = isDark(paper) ? "FFFFFF" : "000000";
  const c = normalizeHex(color, "000000");
  for (let step = 0; step <= 10; step++) {
    const candidate = mix(c, target, step / 10);
    if (contrast(candidate, paper) >= minimum) return candidate;
  }
  return target;
}

/** Black or white, whichever reads better on `fill` (title bars). */
export function textOn(fill: string): string {
  return contrast("FFFFFF", fill) >= contrast("111111", fill) ? "FFFFFF" : "111111";
}

export interface LookSettings {
  slidePreset: SlidePreset;
  ink: string;
  paper: string;
  font: FontId;
  fontName: string;
}

/** Ink and paper as 6-digit hex (no #) for the current preset. */
export function resolveLook(s: Pick<LookSettings, "slidePreset" | "ink" | "paper">): { ink: string; paper: string } {
  const p = s.slidePreset === "custom" ? { ink: s.ink, paper: s.paper } : PRESETS[s.slidePreset] || PRESETS.light;
  return { ink: normalizeHex(p.ink, "171717"), paper: normalizeHex(p.paper, "FFFFFF") };
}

export function fontLines(font: FontId, fontName: string): string[] {
  if (font === "system") {
    const name = (fontName || "").replace(/[{}\\%#$&^_~]/g, "").trim();
    if (!name) return [];
    // mathastext makes math letters and digits use the text font, which is
    // the point of picking the slide's font.
    return ["\\usepackage{fontspec}", `\\setmainfont{${name}}`, `\\setsansfont{${name}}`, "\\usepackage[italic]{mathastext}"];
  }
  return (FONTS.find((f) => f.id === font) || FONTS[0]).lines;
}

export function needsUnicodeEngine(font: FontId, fontName: string): boolean {
  return font === "system" && !!(fontName || "").trim();
}

/**
 * Applies the Look to a compile request. A full `\documentclass` source is
 * left alone: its author owns the colours and fonts. A snippet gets the font
 * and ink definitions in its preamble, and starts in the ink colour. Text,
 * TikZ strokes, chemfig, circuitikz and tikz-cd all inherit it; anything
 * coloured explicitly keeps its own colour.
 *
 * Starting the body with `\color{texerInk}` is safe even before the user's
 * own `\usepackage` lines: the server hoists those wherever they appear.
 */
export function applyLook(source: string, preamble: string, look: LookSettings): { source: string; preamble: string } {
  if (/\\documentclass/.test(source)) return { source, preamble };
  const { ink } = resolveLook(look);
  const lines = [
    ...fontLines(look.font, look.fontName),
    `\\definecolor{texerInk}{HTML}{${ink}}`,
    // pgfplots draws its axis frame and ticks in hard-coded black, so the
    // ink alone would leave a black frame around an otherwise light plot.
    "\\AtBeginDocument{\\ifdefined\\pgfplotsset\\pgfplotsset{every axis/.append style={axis line style={texerInk},tick style={texerInk}}}\\fi}",
  ];
  return {
    source: `\\color{texerInk}\n${source}`,
    preamble: [lines.join("\n"), preamble].filter((x) => x.trim()).join("\n"),
  };
}

/** A Math-workspace expression as a TeX snippet (used when MathJax can't do the font). */
export function wrapMath(source: string, display: boolean): string {
  const expr = source.trim();
  if (/^(\$|\\\[|\\\(|\\begin\{(equation|align|gather|multline)\*?\})/.test(expr)) return expr;
  return display ? `$\\displaystyle ${expr}$` : `$${expr}$`;
}
