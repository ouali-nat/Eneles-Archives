/**
 * The editing tools the assistant uses, and the session that applies them to
 * an in-memory copy of the project. Nothing here talks to a model or a
 * database, so it is shared by every provider and covered by unit tests.
 */

export interface ProjectFile {
  path: string;
  content: string;
}

export interface FileEdit {
  path: string;
  oldContent: string;
  newContent: string;
  /** The file does not exist yet; accepting it creates it. */
  created?: boolean;
  /** The assistant proposes to delete the file; `newContent` is empty. */
  deleted?: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  compileErrors?: string;
  selection?: string;
}

export interface ChatInput {
  /** Who is asking, so the use can be counted against them. */
  userId?: number;
  message: string;
  files: ProjectFile[];
  /** Reference papers attached to the project, under `references/<id>/`. Read-only. */
  references?: ProjectFile[];
  activeFilePath?: string;
  /** The project's tab size: nested lines are indented by this many spaces. */
  tabSize?: number;
  history?: ChatTurn[];
  context?: ChatContext;
}

/** Tool definitions in one neutral form; each provider maps them to its own shape. */
export const TOOL_SPECS = [
  {
    name: 'read_file',
    description:
      'Read the full content of a project file, or of a file in an attached reference paper (a path under references/).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, e.g. main.tex' },
      },
      required: ['path'],
    },
  },
  {
    name: 'replace_in_file',
    description:
      'Replace one exact occurrence of `find` with `replace` in a file. Prefer this for every change: ' +
      'include enough surrounding text in `find` to make it unique. Fails if `find` is missing or appears more than once.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        find: {
          type: 'string',
          description: 'Exact text to replace, unique in the file',
        },
        replace: { type: 'string', description: 'Text to put in its place' },
      },
      required: ['path', 'find', 'replace'],
    },
  },
  {
    name: 'write_file',
    description:
      'Replace a whole file, or create a new one. Only for new files or rewrites too large for replace_in_file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: {
          type: 'string',
          description: 'The complete new file content',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description:
      'Delete a project file. Only when the author asks for a file to be removed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
] as const;

export type ToolName = (typeof TOOL_SPECS)[number]['name'];

/**
 * The project as the assistant changes it. Edits to one file fold into one
 * proposal (the original content against the latest), and a file that ends
 * where it started is not proposed at all.
 */
export class EditSession {
  private readonly original = new Map<string, string>();
  /** null: the assistant deleted the file. */
  private readonly current = new Map<string, string | null>();
  /** Reference papers: readable, never editable, never part of a proposal. */
  private readonly references = new Map<string, string>();
  /** The paths read during this answer, in the order they were first read. */
  private readonly readPaths = new Set<string>();

  constructor(files: ProjectFile[], references: ProjectFile[] = []) {
    for (const f of files) {
      this.original.set(f.path, f.content);
      this.current.set(f.path, f.content);
    }
    for (const f of references) this.references.set(f.path, f.content);
  }

  paths(): string[] {
    return [...this.current.entries()]
      .filter(([, c]) => c !== null)
      .map(([p]) => p);
  }

  /** What the assistant looked at to answer, for the interface to show under the answer. */
  read(): string[] {
    return [...this.readPaths];
  }

  /** Runs one tool call and returns what the model is told. */
  run(
    name: string,
    input: Record<string, unknown>,
  ): { ok: boolean; result: string } {
    const path = typeof input.path === 'string' ? input.path : '';
    if (!path) return { ok: false, result: 'Error: `path` is required.' };

    if (name === 'read_file') {
      const content =
        this.current.get(path) ?? this.references.get(path) ?? undefined;
      if (content !== undefined) this.readPaths.add(path);
      return content === undefined
        ? {
            ok: false,
            result: `Error: no file named ${path}. Files: ${this.paths().join(', ')}`,
          }
        : { ok: true, result: content };
    }

    if (path.startsWith('references/') || this.references.has(path))
      return {
        ok: false,
        result:
          "Error: reference papers are read-only. Change the author's own files instead.",
      };

    if (name === 'replace_in_file') {
      const find = typeof input.find === 'string' ? input.find : '';
      const replace = typeof input.replace === 'string' ? input.replace : '';
      const content = this.current.get(path);
      if (content === undefined || content === null)
        return { ok: false, result: `Error: no file named ${path}.` };
      if (!find)
        return { ok: false, result: 'Error: `find` must not be empty.' };
      const first = content.indexOf(find);
      if (first === -1)
        return {
          ok: false,
          result:
            'Error: `find` does not occur in the file. Read the file and copy the text exactly.',
        };
      if (content.indexOf(find, first + find.length) !== -1)
        return {
          ok: false,
          result:
            'Error: `find` occurs more than once. Include more surrounding text.',
        };
      this.current.set(
        path,
        content.slice(0, first) + replace + content.slice(first + find.length),
      );
      return { ok: true, result: 'Replaced.' };
    }

    if (name === 'write_file' || name === 'edit_file') {
      const content = typeof input.content === 'string' ? input.content : '';
      this.current.set(path, content);
      return {
        ok: true,
        result: this.original.has(path) ? 'File replaced.' : 'File created.',
      };
    }

    if (name === 'delete_file') {
      if (this.current.get(path) == null)
        return { ok: false, result: `Error: no file named ${path}.` };
      if (this.original.has(path)) this.current.set(path, null);
      else this.current.delete(path);
      return { ok: true, result: 'File deleted.' };
    }

    return { ok: false, result: `Error: unknown tool ${name}.` };
  }

  edits(): FileEdit[] {
    const out: FileEdit[] = [];
    for (const [path, now] of this.current) {
      const existed = this.original.has(path);
      const oldContent = this.original.get(path) ?? '';
      if (now === null)
        out.push({ path, oldContent, newContent: '', deleted: true });
      else if (!existed)
        out.push({ path, oldContent: '', newContent: now, created: true });
      else if (now !== oldContent)
        out.push({ path, oldContent, newContent: now });
    }
    return out;
  }
}

export function buildSystemPrompt(input: ChatInput): string {
  const files = input.files
    .map((f) => `- ${f.path} (${f.content.length} characters)`)
    .join('\n');
  const parts = [
    "You are the writing assistant inside Eneles, a LaTeX editor. You change the author's project only through the tools; every change is shown to the author as a diff to accept or reject.",
    `Project files:\n${files}`,
    input.references?.length
      ? `Reference papers the author attached (read-only LaTeX sources; read them with read_file when the request depends on them, and never edit them):\n${input.references.map((f) => `- ${f.path} (${f.content.length} characters)`).join('\n')}`
      : '',
    input.activeFilePath
      ? `The author is looking at ${input.activeFilePath}.`
      : '',
    [
      'How to work:',
      '- Read a file before changing it, and change only what was asked.',
      '- Prefer replace_in_file with a unique `find`; use write_file only for new files or large rewrites, and delete_file only when asked to remove a file.',
      '- Keep the preamble, packages, and structure unless asked; add \\usepackage lines when a change needs them.',
      '- Keep \\begin and \\end balanced, use \\label and \\ref for cross references, and \\cite with the existing bibliography.',
      `- Indent nested lines (inside environments, lists, and tables) by ${input.tabSize ?? 4} spaces per level, the project's tab size, and never with tab characters.`,
      '- Never invent citations, data, or results. If something is missing, say what the author needs to supply.',
      '- Reply briefly in plain text: what you changed and anything the author should check.',
    ].join('\n'),
    input.context?.compileErrors
      ? `The last compile reported these errors (fix their causes; line numbers refer to the files as they are now):\n${input.context.compileErrors}`
      : '',
    input.context?.selection
      ? `The author has selected this text in ${input.activeFilePath ?? 'the active file'}:\n${input.context.selection}`
      : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

/**
 * The development-only provider: scripted answers and edits with no model call, so every state of the assistant's interface can be exercised locally for free. It reads what a model would read and answers in the same shape (Markdown, math, code, one or more proposed files), and says plainly that no model was called.
 *   "title <text>"            sets \title{...}
 *   compile errors in context  explains the first one and changes nothing
 *   "explain …", "why …"       an explanation of the selection or the file, no edits
 *   "cite …"                   where citations look needed, no edits
 *   "table …"                  proposes a table before \end{document}
 *   "new file …"               proposes a file that does not exist yet
 *   anything else              a note in the active file, and one in a second file when there is one, so a proposal spans files
 */
export function localReply(input: ChatInput): {
  message: string;
  edits: FileEdit[];
  read: string[];
} {
  const session = new EditSession(input.files, input.references);
  const path =
    input.activeFilePath && session.paths().includes(input.activeFilePath)
      ? input.activeFilePath
      : (session.paths().find((p) => p.endsWith('.tex')) ?? session.paths()[0]);
  const notice = '_Local development assistant: no model was called._';
  const done = (message: string) => ({
    message: `${message}\n\n${notice}`,
    edits: session.edits(),
    read: session.read(),
  });
  if (!path) return done('This project has no files to change.');
  const content = session.run('read_file', { path }).result;
  const ask = input.message.trim();
  const selection = input.context?.selection?.trim();

  const title = /\btitle\b(?:\s+(?:to|as))?\s*[:"“]?\s*(.+?)["”]?\s*$/i.exec(
    ask,
  )?.[1];
  const titleMatch = /\\title\{[^}]*\}/.exec(content);
  if (title && titleMatch) {
    session.run('replace_in_file', {
      path,
      find: titleMatch[0],
      replace: `\\title{${title}}`,
    });
    return done(`I set the title in \`${path}\` to **${title}**.`);
  }

  if (input.context?.compileErrors) {
    const first =
      input.context.compileErrors
        .split('\n')
        .find((l) => l.trim())
        ?.trim() ?? '';
    return done(
      [
        'The first error from the last compile is:',
        '',
        '```text',
        first,
        '```',
        '',
        'What usually causes it:',
        '',
        '1. A command that is misspelled, or whose package is not loaded in the preamble.',
        '2. A `\\begin{…}` with no matching `\\end{…}`, a few lines above where the error is reported.',
        '3. A `$` that opens math and is never closed.',
        '',
        'I did not change anything. Fix the first error and compile again: the errors after it are often its echoes.',
      ].join('\n'),
    );
  }

  if (/^(explain|why|what|how)\b/i.test(ask)) {
    const subject =
      selection ??
      content
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('%'))
        .slice(0, 6)
        .join('\n');
    const commands = [...new Set(subject.match(/\\[a-zA-Z]+/g) ?? [])].slice(
      0,
      5,
    );
    return done(
      [
        selection
          ? 'Here is what the selected source does.'
          : `Here is how \`${path}\` begins.`,
        '',
        '```latex',
        subject.slice(0, 600),
        '```',
        '',
        commands.length ? '### Commands it uses' : '### What to know',
        '',
        ...(commands.length
          ? commands.map(
              (c) =>
                `- \`${c}\` is read by LaTeX as a command; what follows in braces is its argument.`,
            )
          : [
              '- Text is typeset as written; a blank line starts a new paragraph.',
            ]),
        '',
        'Math is written between dollar signs, as in $a^2 + b^2 = c^2$, or on its own line:',
        '',
        '$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$',
        '',
        'Nothing was changed.',
      ].join('\n'),
    );
  }

  if (/\bcit(e|ation)/i.test(ask)) {
    const lines = content.split('\n');
    const claims = lines
      .map((text, i) => ({ line: i + 1, text: text.trim() }))
      .filter(
        (l) =>
          l.text.length > 60 &&
          !l.text.startsWith('\\') &&
          !l.text.startsWith('%') &&
          !/\\cite/.test(l.text),
      )
      .slice(0, 4);
    return done(
      claims.length
        ? [
            'These sentences state something a reader may want a source for, and carry no `\\cite`:',
            '',
            ...claims.map(
              (c) =>
                `- Line ${c.line}: "${c.text.slice(0, 90)}${c.text.length > 90 ? '…' : ''}"`,
            ),
            '',
            'I never invent citations. Add the entries to your bibliography, then cite them by key.',
          ].join('\n')
        : `Every long sentence in \`${path}\` already has a citation, or there are none that need one.`,
    );
  }

  const end = '\\end{document}';
  if (/\btable\b/i.test(ask) && content.includes(end)) {
    const table = [
      '\\begin{table}[h]',
      '  \\centering',
      '  \\begin{tabular}{lrr}',
      '    \\hline',
      '    Method & Accuracy & Time (s) \\\\',
      '    \\hline',
      '    Baseline & 0.81 & 12.4 \\\\',
      '    Ours & 0.87 & 9.8 \\\\',
      '    \\hline',
      '  \\end{tabular}',
      '  \\caption{Replace these sample rows with your results.}',
      '  \\label{tab:results}',
      '\\end{table}',
      '',
    ].join('\n');
    session.run('replace_in_file', {
      path,
      find: end,
      replace: `${table}\n${end}`,
    });
    return done(
      `I added a three-column table before \`\\end{document}\` in \`${path}\`, with the label \`tab:results\`. The rows are placeholders: replace them with your numbers.`,
    );
  }

  if (/\bnew file\b/i.test(ask)) {
    session.run('write_file', {
      path: 'notes/assistant-notes.tex',
      content: `% Notes\n% ${ask.replace(/\s+/g, ' ').slice(0, 200)}\n`,
    });
    return done(
      'I propose a new file, `notes/assistant-notes.tex`, holding your note. Accepting it creates the file; nothing includes it yet.',
    );
  }

  const anchor = '\\begin{document}';
  const note = `% Note: ${ask.replace(/\s+/g, ' ').slice(0, 200)}`;
  if (content.includes(anchor))
    session.run('replace_in_file', {
      path,
      find: anchor,
      replace: `${anchor}\n${note}`,
    });
  else session.run('write_file', { path, content: `${note}\n${content}` });
  // A second file, when there is one, so the proposal has more than one file to accept or reject.
  const other = session.paths().find((p) => p !== path && p.endsWith('.tex'));
  if (other) {
    const otherContent = session.run('read_file', { path: other }).result;
    session.run('write_file', {
      path: other,
      content: `% See the note in ${path}.\n${otherContent}`,
    });
  }
  const turn = Math.floor((input.history?.length ?? 0) / 2) + 1;
  return done(
    [
      `I added your request as a note after \`\\begin{document}\` in \`${path}\`${other ? `, and a pointer to it at the top of \`${other}\`` : ''}.`,
      '',
      'Review each file below, then accept or reject it.',
      '',
      `This is turn ${turn} of the conversation.`,
    ].join('\n'),
  );
}
