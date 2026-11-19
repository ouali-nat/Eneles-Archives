/**
 * Normalise LaTeX indentation by nesting depth.
 *
 * The library and template sources were authored by hand over time and their
 * indentation is inconsistent: `\begin{axis}` frequently sits flush with the
 * `\begin{tikzpicture}` that contains it, so nesting is invisible in exactly
 * the examples where structure matters most.
 *
 * Rather than reformat the source data by hand, this derives indentation from
 * the document's own structure, so it stays correct as examples are edited and
 * applies equally to what we display, what we insert into the editor, and what
 * we write into a new project.
 *
 * The rule is the obvious one: every `\begin{...}` indents what follows by one
 * level, and its `\end{...}` returns to the opener's level. Bracketed option
 * blocks left hanging at end of line get the same treatment, so
 *
 *     \begin{axis}[
 *       view={60}{30},
 *     ]
 *       \addplot3 ...
 *     \end{axis}
 *
 * closes the option block back to the `\begin` and returns content to the
 * environment's level, instead of drifting one step further right with each
 * bracket.
 */

interface OpenBlock {
  kind: "environment" | "group";
  /** Column the opening line was emitted at. Its closer returns here. */
  indent: number;
}

export interface ReindentOptions {
  /** One level of indentation. Defaults to two spaces. */
  indentUnit?: string;
  /**
   * Environments whose contents are left at the parent level. `document` is
   * the usual candidate: indenting an entire template body by one level is
   * technically consistent and almost never what an author wants to read.
   */
  flatEnvironments?: string[];
  /**
   * Environments whose contents are copied through untouched. Whitespace is
   * significant inside verbatim-like environments, so reindenting them changes
   * what the document renders.
   */
  literalEnvironments?: string[];
}

const DEFAULT_LITERAL = [
  "verbatim",
  "Verbatim",
  "lstlisting",
  "minted",
  "alltt",
  "tikzpicture*",
];

/** Net unclosed `[` or `{` on a line, ignoring comments and escaped brackets. */
function netOpenBrackets(line: string): number {
  const cleaned = line
    .replace(/\\%/g, "")
    .replace(/(^|[^\\])%.*$/, "$1")
    .replace(/\\[{}[\]]/g, "");

  let depth = 0;
  for (const char of cleaned) {
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
  }
  return depth;
}

function environmentName(line: string, keyword: "begin" | "end"): string | null {
  const match = new RegExp(`\\\\${keyword}\\s*\\{([^}]*)\\}`).exec(line);
  return match ? match[1].trim() : null;
}

export function reindentLatex(
  source: string,
  options: ReindentOptions = {},
): string {
  const {
    indentUnit = "  ",
    flatEnvironments = [],
    literalEnvironments = DEFAULT_LITERAL,
  } = options;

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const stack: OpenBlock[] = [];

  // When inside a verbatim-like environment, lines are emitted byte for byte.
  let literalDepth = 0;
  let literalName: string | null = null;
  let literalIndent = 0;

  /**
   * Column for a line that opens nothing and closes nothing.
   *
   * One deeper than whatever is currently open, rather than `stack.length`.
   * A line like `\begin{axis}[` opens an environment and an option group at
   * the same time, and both are entered from the same column, so counting the
   * stack would step the body two levels right instead of one.
   */
  const contentIndent = () =>
    stack.length === 0 ? 0 : stack[stack.length - 1].indent + 1;

  for (const raw of lines) {
    if (literalName) {
      if (environmentName(raw, "end") === literalName) {
        literalDepth--;
        if (literalDepth === 0) {
          // The closer rejoins the document; only the body is untouched.
          out.push(indentUnit.repeat(literalIndent) + raw.trim());
          literalName = null;
          continue;
        }
      } else if (environmentName(raw, "begin") === literalName) {
        literalDepth++;
      }
      out.push(raw);
      continue;
    }

    const line = raw.trim();
    if (!line) {
      // Never leave trailing whitespace on a blank line.
      out.push("");
      continue;
    }

    // Closers resolve before the line is written, so they land on the same
    // column as whatever opened them.
    let indent: number;
    if (/^\\end\s*\{/.test(line)) {
      let popped: OpenBlock | undefined;
      // Discard any option groups the author left open inside the environment.
      while (stack.length > 0) {
        popped = stack.pop();
        if (popped?.kind === "environment") break;
      }
      indent = popped?.indent ?? 0;
    } else if (/^[\]}]/.test(line) && stack[stack.length - 1]?.kind === "group") {
      indent = stack.pop()!.indent;
    } else {
      indent = contentIndent();
    }

    out.push(indentUnit.repeat(indent) + line);

    // Openers raise the level for subsequent lines.
    const opened = environmentName(line, "begin");
    if (opened) {
      if (literalEnvironments.includes(opened)) {
        literalName = opened;
        literalDepth = 1;
        literalIndent = indent;
        continue;
      }
      // A `\begin` and `\end` on the same line cancel out.
      const closedInline = environmentName(line, "end");
      if (closedInline !== opened && !flatEnvironments.includes(opened)) {
        stack.push({ kind: "environment", indent });
      }
    }

    // A trailing unclosed bracket opens an option block. The `\begin{axis}[`
    // case already pushed an environment above, and this adds the group on
    // top, which is what makes the closing `]` land back on the `\begin`.
    if (netOpenBrackets(line) > 0) {
      stack.push({ kind: "group", indent });
    }
  }

  return out.join("\n");
}
