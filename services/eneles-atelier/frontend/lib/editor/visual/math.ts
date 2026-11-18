/**
 * Math through KaTeX, the same renderer the rest of the app uses, with the project's own macros. Results are cached by source, and anything KaTeX cannot typeset comes back as null so the caller can show the source instead.
 */
import katex from "katex";
import { splitRows } from "./scan";

const cache = new Map<string, string | null>();
const CACHE_SIZE = 600;

export function renderMath(tex: string, display: boolean, macros: Record<string, string>, macrosKey: string): string | null {
  const key = `${display ? "D" : "I"}${macrosKey}\u0000${tex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string | null;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      // trust: false keeps \href, \includegraphics, and friends out of KaTeX's output.
      trust: false,
      strict: "ignore",
      maxExpand: 1000,
      maxSize: 20,
      // A copy: KaTeX writes \gdef definitions back into the object it is given.
      macros: { ...macros },
    });
  } catch {
    html = null;
  }
  cache.set(key, html);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return html;
}

/** What to hand KaTeX for a display-math environment's body, with each numbered row tagged with the number LaTeX would give it. */
export function displaySource(env: string | null, body: string, numbers: string[] | undefined): string {
  const clean = body.replace(/\\label\s*\{[^}]*\}/g, "").replace(/\\(nonumber|notag)\b/g, "");
  const base = (env ?? "").replace(/\*$/, "");
  const tag = (n: string | undefined) => (n ? `\\tag{${n}}` : "");
  if (/^(align|flalign|eqnarray|alignat|gather)$/.test(base)) {
    const rows = splitRows(body);
    const inner = rows
      .map((row, i) => {
        const r = row.replace(/\\label\s*\{[^}]*\}/g, "").replace(/\\(nonumber|notag)\b/g, "");
        return /\\tag\*?\s*\{/.test(r) ? r : r + tag(numbers?.[i]);
      })
      .join("\\\\");
    if (base === "gather") return `\\begin{gather*}${inner}\\end{gather*}`;
    if (base === "alignat") return `\\begin{align*}${inner.replace(/^\s*\{\d+\}/, "")}\\end{align*}`;
    if (base === "eqnarray") return `\\begin{align*}${inner.replace(/&([^&\\]*)&/g, "&$1")}\\end{align*}`;
    return `\\begin{align*}${inner}\\end{align*}`;
  }
  if (base === "multline") return `\\begin{gather*}${clean}${/\\tag/.test(clean) ? "" : tag(numbers?.[0])}\\end{gather*}`;
  return /\\tag\*?\s*\{/.test(clean) ? clean : clean + tag(numbers?.[0]);
}
