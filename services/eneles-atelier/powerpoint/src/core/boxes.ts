// Theorem-style box builder. Keep in step with
// impress/python/pythonpath/texer_imp/boxes.py.
//
// The label is free text ("Conjecture", "Claim", anything). The built-in
// presets are quick picks for a label + accent; users can save their own
// (label, style, accent, fill) in the library.

import { mix, normalizeHex, readableOn, textOn } from "./look";
import { BoxStyle } from "./types";

export const BUILTIN_PRESETS: { label: string; accent: string }[] = [
  { label: "Theorem", accent: "222B82" },
  { label: "Lemma", accent: "A5410D" },
  { label: "Proposition", accent: "222B82" },
  { label: "Corollary", accent: "39558B" },
  { label: "Definition", accent: "17636C" },
  { label: "Conjecture", accent: "7A2E8A" },
  { label: "Claim", accent: "8A5A00" },
  { label: "Axiom", accent: "1F5F99" },
  { label: "Remark", accent: "5A6270" },
  { label: "Example", accent: "366D43" },
  { label: "Note", accent: "5A6270" },
];
export const DEFAULT_ACCENT = "222B82";

export const STYLES: { id: BoxStyle; label: string }[] = [
  { id: "bar", label: "Left bar" },
  { id: "frame", label: "Frame" },
  { id: "rounded", label: "Rounded" },
  { id: "titlebar", label: "Title bar" },
  { id: "plain", label: "Plain" },
];

/** How far the automatic fill is mixed from the accent toward the paper. */
const FILL_WEIGHT = 0.9;

export function defaultAccent(label: string): string {
  return (BUILTIN_PRESETS.find((p) => p.label === label.trim()) || { accent: DEFAULT_ACCENT }).accent;
}

/**
 * Accent, fill and title-bar text actually used, as 6-digit hex. The accent
 * is nudged until it reads on the paper, so a navy Theorem still works on a
 * dark slide. An empty fill means "tint of the accent toward the paper".
 */
export function boxColors(accent: string, fill: string, paper: string): { accent: string; fill: string; titleText: string } {
  const p = normalizeHex(paper, "FFFFFF");
  const a = readableOn(normalizeHex(accent, DEFAULT_ACCENT), p);
  const f = normalizeHex(fill) || mix(a, p, FILL_WEIGHT);
  return { accent: a, fill: f, titleText: textOn(a) };
}

export interface BoxFields {
  label: string;
  number: string;
  auto: boolean;
  title: string;
  content: string;
  style: BoxStyle;
  accent: string;
  /** "" = automatic tint toward the paper. */
  fill: string;
  width: number;
  unit: string;
}

/**
 * The tcolorbox source. `widthTex` is the minipage width (a TeX dimension);
 * the box sits in that minipage and is sized to \linewidth inside it.
 * Otherwise standalone's preview crop measures the full-width paragraph and
 * every box comes out the same width.
 */
export function buildBoxSource(f: BoxFields, widthTex: string, paper: string): string {
  const style: BoxStyle = STYLES.some((s) => s.id === f.style) ? f.style : "bar";
  const label = f.label.trim() || "Theorem";
  const c = boxColors(f.accent || defaultAccent(label), f.fill, paper);
  const head = [label, f.number.trim()].filter(Boolean).join(" ");
  const title = f.title.trim();

  const options = [
    "  enhanced,",
    "  colback=texerBoxBackground,",
    "  coltext=texerInk,",
    "  width=\\linewidth,",
    "  left=4mm, right=4mm, top=3.2mm, bottom=3.2mm,",
    "  before skip=0pt, after skip=0pt,",
  ];
  let bodyHeading = true;
  if (style === "bar") {
    options.push("  frame hidden,", "  sharp corners,", "  borderline west={1.25mm}{0pt}{texerBoxAccent},");
  } else if (style === "frame") {
    options.push("  sharp corners,", "  colframe=texerBoxAccent,", "  boxrule=0.5mm,");
  } else if (style === "rounded") {
    options.push("  arc=2.5mm,", "  colframe=texerBoxAccent,", "  boxrule=0.5mm,");
  } else if (style === "titlebar") {
    options.push(
      "  sharp corners,",
      "  colframe=texerBoxAccent,",
      "  colbacktitle=texerBoxAccent,",
      "  coltitle=texerBoxTitleText,",
      "  boxrule=0.5mm,",
      "  fonttitle=\\bfseries,",
      `  title={${head}${title ? ": " + title : ""}},`,
    );
    bodyHeading = false;
  } else {
    options.push("  frame hidden,", "  sharp corners,");
  }

  const lines = [
    "\\usepackage[most]{tcolorbox}",
    // The Look normally defines texerInk; this keeps a pasted box compiling on its own.
    "\\providecolor{texerInk}{HTML}{171717}",
    `\\definecolor{texerBoxAccent}{HTML}{${c.accent}}`,
    `\\definecolor{texerBoxBackground}{HTML}{${c.fill}}`,
    `\\definecolor{texerBoxTitleText}{HTML}{${c.titleText}}`,
    `\\begin{minipage}{${widthTex}}`,
    "\\begin{tcolorbox}[",
    ...options,
    "]",
  ];
  if (bodyHeading) {
    lines.push(
      `{\\color{texerBoxAccent}\\bfseries ${head}}${title ? ` {\\color{texerBoxAccent}${title}}` : ""}\\\\[1.2mm]`,
    );
  }
  lines.push(
    f.content.trim() || "% Write the statement here. Inline math such as $f\\colon A \\to B$ is supported.",
    "\\end{tcolorbox}",
    "\\end{minipage}",
  );
  return lines.join("\n");
}

/** The number after the highest numeric one already used ("1" if none). */
export function nextNumber(existing: string[]): string {
  let best = 0;
  for (const n of existing) {
    const v = parseInt(String(n).trim(), 10);
    if (Number.isFinite(v) && String(v) === String(n).trim()) best = Math.max(best, v);
  }
  return String(best + 1);
}

