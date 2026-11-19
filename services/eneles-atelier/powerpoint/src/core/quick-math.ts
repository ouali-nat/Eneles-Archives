// Client-side math rendering via MathJax's TeX->SVG engine. Loaded from a
// CDN <script> tag in taskpane.html (see index.html's tex-svg.js include).
// this gives instant, offline-after-first-load rendering for the common
// case (inline/display math) with zero round-trips to anything, local
// server included.
//
// We deliberately do NOT bundle MathJax via npm: mathjax-full's webpack
// story is awkward (it wants a Node "liteAdaptor" or heavy config for
// browser builds) and the prebuilt combined component
// (https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js) is exactly what
// MathJax itself recommends for browser usage.

export interface QuickMathOptions {
  display: boolean;
  color: string;
}

interface MathJaxGlobal {
  startup: { promise: Promise<void> };
  tex2svgPromise(input: string, options?: { display?: boolean }): Promise<HTMLElement>;
  texReset?: () => void;
}

declare global {
  interface Window {
    MathJax?: MathJaxGlobal;
  }
}

export class QuickMathError extends Error {}

async function waitForMathJax(): Promise<MathJaxGlobal> {
  const deadline = Date.now() + 15000;
  while (!window.MathJax || !window.MathJax.startup) {
    if (Date.now() > deadline) {
      throw new QuickMathError("MathJax failed to load (no internet on first run, or the CDN is blocked).");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  await window.MathJax.startup.promise;
  return window.MathJax;
}

/** Renders a TeX expression to a standalone SVG string, ready to rasterize or insert. */
export async function renderMathToSvg(latex: string, opts: QuickMathOptions): Promise<string> {
  const mathJax = await waitForMathJax();

  let container: HTMLElement;
  try {
    container = await mathJax.tex2svgPromise(latex, { display: opts.display });
  } catch (e) {
    throw new QuickMathError(e instanceof Error ? e.message : "MathJax failed to render this expression.");
  }

  const svg = container.querySelector("svg");
  if (!svg) {
    throw new QuickMathError("MathJax did not return an SVG (unexpected).");
  }

  // MathJax's glyph paths use fill="currentColor". Set `color` on the root
  // so a bare, out-of-DOM SVG string still resolves to the right ink.
  svg.setAttribute("style", `color: ${opts.color}; ${svg.getAttribute("style") || ""}`);
  svg.removeAttribute("width");
  svg.removeAttribute("height");

  // Reset MathJax's internal equation numbering/label state between calls
  // so repeated renders in one session don't accumulate stale references.
  mathJax.texReset?.();

  return new XMLSerializer().serializeToString(svg);
}
