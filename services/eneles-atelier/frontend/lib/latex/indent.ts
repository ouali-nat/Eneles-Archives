/**
 * LaTeX smart indentation: computes indent string for the current cursor position
 * based on \begin...\end nesting.
 *
 * `tabSize` is passed in from the project settings so indentation always
 * matches the user's configured tab size (2 or 4 spaces).
 */

const LIST_ENVS = new Set(["itemize", "enumerate", "description", "list"]);

function parseEnvironments(text: string): {
  level: number;
  inListEnv: boolean;
} {
  const stack: string[] = [];
  const beginRe = /\\(?:begin|end)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = beginRe.exec(text)) !== null) {
    const name = m[1].trim().toLowerCase();
    if (m[0].startsWith("\\begin")) {
      stack.push(name);
    } else {
      if (stack.length > 0) stack.pop();
    }
  }
  const inListEnv = stack.length > 0 && LIST_ENVS.has(stack[stack.length - 1]);
  return { level: stack.length, inListEnv };
}

/**
 * Compute the indent string for a new line at the given position.
 * Used when pressing Enter.
 * Preserves the current line's indent or uses environment-based indent
 * (whichever is deeper). Does NOT auto-insert \item: the user types it themselves.
 */
export function getLatexIndentForNewLine(
  doc: string,
  pos: number,
  tabSize: number = 4,
): string {
  const indentStr = " ".repeat(tabSize);
  const textBefore = doc.slice(0, pos);
  const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
  const lineTextToCursor = doc.slice(lineStart, pos);
  const lineIndent = lineTextToCursor.match(/^([ \t]*)/)?.[1] ?? "";

  const { level } = parseEnvironments(textBefore);

  // Use the LARGER of: current line indent vs environment-based indent
  const envIndent = indentStr.repeat(Math.max(0, level));
  const baseIndent =
    lineIndent.length >= envIndent.length ? lineIndent : envIndent;

  return baseIndent;
}

/**
 * Apply the current line's indent to each line of the inserted text.
 * Preserves the snippet's relative indentation structure while shifting the whole block.
 * Used when inserting snippets from palette so they match the current indentation level.
 */
export function applyIndentToInsertedText(
  doc: string,
  insertPos: number,
  text: string,
): string {
  if (!text.includes("\n")) return text;

  const lineStart = doc.lastIndexOf("\n", insertPos - 1) + 1;
  const lineText = doc.slice(lineStart, insertPos);
  const currentIndent = lineText.match(/^([ \t]*)/)?.[1] ?? "";

  const lines = text.split("\n");
  // Find minimum indent length in the snippet (the "base" level)
  let minIndentLen = Infinity;
  for (const line of lines) {
    const m = line.match(/^([ \t]*)/);
    const len = m ? m[1].length : 0;
    minIndentLen = Math.min(minIndentLen, len);
  }
  if (minIndentLen === Infinity) minIndentLen = 0;

  // Shift each line: replace snippet's base indent with currentIndent, preserve relative indent
  // First line: no currentIndent; it's inserted at cursor which is already after the line's indent
  // Subsequent lines: need currentIndent since they start new lines
  return lines
    .map((line, i) => {
      const lineIndent = line.match(/^([ \t]*)/)?.[1] ?? "";
      const rest = line.slice(lineIndent.length);
      const extraIndent = lineIndent.slice(minIndentLen);
      return i === 0 ? extraIndent + rest : currentIndent + extraIndent + rest;
    })
    .join("\n");
}

/**
 * A snippet's indentation in the project's tab size. Snippets are written with their own step (two or four spaces, or tabs); each line's indent beyond the snippet's base is counted in those steps and rewritten in steps of `unit` columns, so an environment inserted into a 2-space project is indented by 2 and into a 4-space one by 4. A remainder smaller than a step (alignment) is kept as it is.
 */
export function rescaleIndent(text: string, unit: number): string {
  if (!text.includes("\n") || unit < 1) return text;
  const lines = text.split("\n");
  const widths = lines.map((line) => (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, " ".repeat(unit)).length);
  // The first line goes in at the cursor, so only the lines after it set the base and the step.
  // An empty line says nothing about indentation; a line of only spaces (where a snippet leaves the cursor) does.
  const rest = lines.slice(1).map((line, i) => ({ blank: line.length === 0, width: widths[i + 1] }));
  const filled = rest.filter((l) => !l.blank);
  if (!filled.length) return text;
  const base = Math.min(...filled.map((l) => l.width));
  const step = Math.min(...filled.map((l) => l.width - base).filter((w) => w > 0), Infinity);
  if (!Number.isFinite(step) || step === unit) return text;
  return lines
    .map((line, i) => {
      if (i === 0 || line.length === 0) return line;
      const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
      const extra = widths[i] - base;
      return " ".repeat(base + Math.floor(extra / step) * unit + (extra % step)) + line.slice(lead.length);
    })
    .join("\n");
}
