import { API_URL } from "@/lib/api";

/**
 * Compiles a small LaTeX document through the public preview endpoint and returns its first page as an image URL, for thumbnails and worked examples.
 *
 * - At most two compiles run at once, so a page full of previews does not flood the compiler.
 * - The endpoint is rate limited per visitor (results it has already compiled are served from its cache and do not count). A 429 means "not yet": the job waits and asks again instead of failing.
 * - Results are kept for the session, keyed by source, so the same figure is never compiled twice.
 */
const cache = new Map<string, Promise<string | null>>();
const queue: (() => Promise<void>)[] = [];
let active = 0;
const LIMIT = 2;

function pump() {
  while (active < LIMIT && queue.length) {
    const job = queue.shift()!;
    active++;
    void job().finally(() => {
      active--;
      pump();
    });
  }
}

class RetryLater {
  constructor(readonly ms: number) {}
}

async function compileOnce(source: string): Promise<string | null> {
  const res = await fetch(`${API_URL}/tikz-compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: [{ path: "main.tex", content: source }], mainFile: "main.tex", engine: "pdflatex", stopOnFirstError: true }),
  });
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after") || res.headers.get("x-ratelimit-reset") || 15);
    throw new RetryLater(Math.min(60, Math.max(2, seconds)) * 1000 + Math.random() * 1000);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success || !data.pdf) return null;
  const { pdfjs } = await import("react-pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const bytes = Uint8Array.from(atob(data.pdf), (c) => c.charCodeAt(0));
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  // Sharp enough for a card or an example at twice its displayed size, without drawing a poster.
  const scale = Math.min(3, 1400 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
  const url = canvas.toDataURL("image/png");
  void pdf.cleanup();
  return url;
}

async function compileWithRetry(source: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await compileOnce(source);
    } catch (e) {
      if (!(e instanceof RetryLater)) return null;
      // Holding the queue slot while waiting keeps the other previews from piling onto the limit too.
      await new Promise((r) => setTimeout(r, e.ms));
    }
  }
  return null;
}

/** The first page of `source` (a complete document) as an image URL, or null when it does not compile. */
export function renderLatexPreview(source: string): Promise<string | null> {
  let pending = cache.get(source);
  if (!pending) {
    pending = new Promise<string | null>((resolve) => {
      queue.push(async () => resolve(await compileWithRetry(source)));
      pump();
    });
    cache.set(source, pending);
  }
  return pending;
}

/** The packages every lesson example can rely on. */
const EXAMPLE_PREAMBLE = String.raw`\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsthm,mathtools}
\usepackage{graphicx,xcolor}
\usepackage{booktabs,array,multirow}
\usepackage{enumitem}
\usepackage{hyperref}
\hypersetup{hidelinks}
\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\theoremstyle{definition}
\newtheorem{definition}{Definition}`;

/** Wraps a lesson's snippet (document body only) in a page cropped to its content. */
export function exampleDocument(body: string): string {
  return `\\documentclass[varwidth=11cm,border=10pt]{standalone}\n${EXAMPLE_PREAMBLE}\n\\begin{document}\n${body}\n\\end{document}\n`;
}
