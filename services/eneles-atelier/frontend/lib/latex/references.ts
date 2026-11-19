/**
 * What a project can cite and refer to: entries in its .bib files and
 * \label{}s in its .tex files, for completion after \cite{ and \ref{.
 */
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

export interface BibEntry {
  key: string;
  type: string;
  title?: string;
  author?: string;
  year?: string;
  file: string;
}

export interface LabelEntry {
  name: string;
  file: string;
  line: number;
  /** The nearest section or caption above it. */
  context?: string;
}

function fieldOf(body: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*[{"]`, "i").exec(body);
  if (!m) return undefined;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  const close = body[i - 1] === '"' ? '"' : "}";
  for (; i < body.length; i++) {
    const ch = body[i];
    if (close === "}" && ch === "{") depth++;
    else if (ch === close && --depth === 0) break;
  }
  return body.slice(start, i).replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function parseBibEntries(text: string, file: string): BibEntry[] {
  const out: BibEntry[] = [];
  const re = /@(\w+)\s*\{\s*([^,\s{}]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble") continue;
    const next = text.indexOf("\n@", re.lastIndex);
    const body = text.slice(re.lastIndex, next === -1 ? undefined : next);
    out.push({
      key: m[2],
      type,
      file,
      title: fieldOf(body, "title"),
      author: fieldOf(body, "author"),
      year: fieldOf(body, "year") ?? fieldOf(body, "date")?.slice(0, 4),
    });
  }
  return out;
}

export function parseLabels(text: string, file: string): LabelEntry[] {
  const out: LabelEntry[] = [];
  const lines = text.split("\n");
  let context: string | undefined;
  lines.forEach((line, i) => {
    const code = line.replace(/(^|[^\\])%.*$/, "$1");
    const heading = /\\(?:part|chapter|section|subsection|subsubsection|paragraph|caption)\*?(?:\[[^\]]*\])?\{([^}]*)\}/.exec(code);
    if (heading) context = heading[1].trim();
    for (const m of code.matchAll(/\\label\{([^}]+)\}/g)) {
      out.push({ name: m[1].trim(), file, line: i + 1, context });
    }
  });
  return out;
}

export interface ProjectIndexSource {
  /** Text of the project's files other than the one being edited. */
  otherFiles: () => { path: string; text: string }[];
  /** The path of the file being edited. */
  activePath: () => string | null;
}

const cache = new Map<string, { text: string; bib: BibEntry[]; labels: LabelEntry[] }>();
function indexed(path: string, text: string) {
  const hit = cache.get(path);
  if (hit && hit.text === text) return hit;
  const entry = {
    text,
    bib: path.toLowerCase().endsWith(".bib") ? parseBibEntries(text, path) : [],
    labels: path.toLowerCase().endsWith(".tex") ? parseLabels(text, path) : [],
  };
  cache.set(path, entry);
  return entry;
}

const CITE = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/;
const REF = /\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref|vref|vpageref|labelcref|subref)\*?\{([^}]*)$/;

/** Completion for citation keys and labels, across every file in the project. */
export function referenceCompletions(source: ProjectIndexSource): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const cite = CITE.exec(before);
    const ref = cite ? null : REF.exec(before);
    if (!cite && !ref) return null;
    const typed = (cite ?? ref)![1];
    // Several keys: \cite{a,b,| completes the last one.
    const lastComma = typed.lastIndexOf(",");
    const from = context.pos - (typed.length - lastComma - 1);
    const current = context.state.doc.toString();
    const activePath = source.activePath() ?? "";
    const files = [...source.otherFiles().filter((f) => f.path !== activePath), { path: activePath, text: current }];

    let options: Completion[];
    if (cite) {
      const seen = new Set<string>();
      options = files
        .flatMap((f) => indexed(f.path, f.text).bib)
        .filter((e) => !seen.has(e.key) && seen.add(e.key))
        .map((e) => ({
          label: e.key,
          type: "variable",
          detail: [e.author?.split(/\s+and\s+/i)[0]?.split(",")[0], e.year].filter(Boolean).join(" "),
          info: e.title ? `${e.title}${e.file ? `\n${e.file}` : ""}` : e.file,
        }));
    } else {
      const seen = new Set<string>();
      options = files
        .flatMap((f) => indexed(f.path, f.text).labels)
        .filter((l) => !seen.has(l.name) && seen.add(l.name))
        .map((l) => ({
          label: l.name,
          type: "constant",
          detail: l.context ? l.context.slice(0, 40) : undefined,
          info: `${l.file}, line ${l.line}`,
        }));
    }
    if (!options.length) return null;
    return { from, options, validFor: /^[^,}\s]*$/ };
  };
}
