import type { AssistantSendOptions } from "./types";

/** What a command can see when it is chosen or sent. */
export interface CommandContext {
  activeFilePath?: string;
  hasSelection: boolean;
  hasCompileErrors: boolean;
}

/** What a command turns into: a prompt for the usual send path, or a local action. */
export type CommandResult = { kind: "send"; prompt: string; options: AssistantSendOptions } | { kind: "clear" };

export interface SlashCommand {
  name: string;
  /** One line under the name in the list. */
  description: string;
  /** Why it cannot run now, shown in place of the description; null when it can. */
  unavailable?: (ctx: CommandContext) => string | null;
  /** The command needs words after it (a table's description): choosing it leaves "/name " in the field. */
  takesInput?: boolean;
  /** Placeholder while the field holds only the command. */
  inputHint?: string;
  build: (ctx: CommandContext, input: string) => CommandResult;
  /** One the person added in Settings, not one of the assistant's own. */
  custom?: boolean;
}

const file = (ctx: CommandContext) => (ctx.activeFilePath ? `\`${ctx.activeFilePath}\`` : "the open file");
const also = (input: string) => (input ? `\n\nAlso: ${input}` : "");

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "fix",
    description: "Fix the errors from the last compile",
    unavailable: (ctx) => (ctx.hasCompileErrors ? null : "No errors in the last compile"),
    build: (_ctx, input) => ({ kind: "send", prompt: `Fix the errors from the last compile. Propose the smallest changes that make the document compile, and say in a sentence what caused each error.${also(input)}`, options: { withErrors: true } }),
  },
  {
    name: "explain",
    description: "Explain the selection in plain words",
    build: (ctx, input) =>
      ctx.hasSelection
        ? { kind: "send", prompt: `Explain the selected text in plain words: what it says, what each command or environment in it does, and anything a reader could trip over. Do not change any file.${also(input)}`, options: { withSelection: true } }
        : { kind: "send", prompt: `Explain what ${file(ctx)} does, section by section, in plain words. Do not change any file.${also(input)}`, options: {} },
  },
  {
    name: "improve",
    description: "Improve the writing of the selection",
    unavailable: (ctx) => (ctx.hasSelection ? null : "Select some text in the editor first"),
    build: (_ctx, input) => ({
      kind: "send",
      prompt: `Improve the writing of the selected text: clearer and shorter sentences, the same meaning, the same voice, and every LaTeX command, label, and citation left intact. Propose it as an edit to the file.${also(input)}`,
      options: { withSelection: true },
    }),
  },
  {
    name: "cite",
    description: "Find where citations are needed in the open file",
    build: (ctx, input) => ({
      kind: "send",
      prompt: `Read ${file(ctx)} and find the claims that need a citation. For each, quote the sentence and say what kind of source would support it. Where the bibliography already has a fitting entry, add the \\cite as an edit; otherwise leave the text as it is.${also(input)}`,
      options: {},
    }),
  },
  {
    name: "table",
    description: "Make a table from a description",
    takesInput: true,
    inputHint: "Describe the table: its columns, rows, and what it shows",
    build: (ctx, input) => ({
      kind: "send",
      prompt: `Make a LaTeX table from this description, with booktabs rules, a caption, and a label, and insert it where it fits in ${file(ctx)}:\n\n${input}`,
      options: {},
    }),
  },
  {
    name: "summarize",
    description: "Summarize the open file",
    build: (ctx, input) => ({ kind: "send", prompt: `Summarize ${file(ctx)} in a short paragraph, then list its main claims or results as bullets. Do not change any file.${also(input)}`, options: {} }),
  },
  {
    name: "proofread",
    description: "Fix spelling, grammar, and typos",
    build: (ctx, input) =>
      ctx.hasSelection
        ? { kind: "send", prompt: `Proofread the selected text: fix spelling, grammar, punctuation, and typos, and nothing else. Keep the wording, the meaning, and every LaTeX command as they are. Propose it as an edit to the file.${also(input)}`, options: { withSelection: true } }
        : { kind: "send", prompt: `Proofread ${file(ctx)}: fix spelling, grammar, punctuation, and typos, and nothing else. Keep the wording, the meaning, and every LaTeX command as they are. Propose the fixes as an edit to the file.${also(input)}`, options: {} },
  },
  {
    name: "shorten",
    description: "Make the selection shorter",
    unavailable: (ctx) => (ctx.hasSelection ? null : "Select some text in the editor first"),
    build: (_ctx, input) => ({ kind: "send", prompt: `Shorten the selected text by about a third without losing a claim, a number, or a citation, and keep every LaTeX command intact. Propose it as an edit to the file.${also(input)}`, options: { withSelection: true } }),
  },
  {
    name: "translate",
    description: "Translate the selection into another language",
    unavailable: (ctx) => (ctx.hasSelection ? null : "Select some text in the editor first"),
    takesInput: true,
    inputHint: "The language to translate into",
    build: (_ctx, input) => ({ kind: "send", prompt: `Translate the selected text into ${input || "English"}. Keep every LaTeX command, label, citation, and formula exactly as it is, and translate only the prose. Propose it as an edit to the file.`, options: { withSelection: true } }),
  },
  {
    name: "abstract",
    description: "Write an abstract for the document",
    build: (ctx, input) => ({ kind: "send", prompt: `Read the document and write an abstract of about 150 words: the problem, the approach, the main result, and why it matters. If ${file(ctx)} has an abstract environment, propose it as an edit there; otherwise give it as text.${also(input)}`, options: {} }),
  },
  {
    name: "equation",
    description: "Write an equation from a description",
    takesInput: true,
    inputHint: "Describe the equation in words",
    build: (_ctx, input) => ({ kind: "send", prompt: `Write this as LaTeX math, in an equation environment with a label, using amsmath where it helps, and say in one line what each symbol stands for:\n\n${input}`, options: {} }),
  },
  {
    name: "review",
    description: "Read the open file as a reviewer would",
    build: (ctx, input) => ({ kind: "send", prompt: `Read ${file(ctx)} as a careful reviewer would. List, most important first, the unclear arguments, unsupported claims, missing definitions, and notation that changes meaning, quoting the passage for each. Do not change any file.${also(input)}`, options: {} }),
  },
  {
    name: "clear",
    description: "Clear the conversation",
    build: () => ({ kind: "clear" }),
  },
];

/* A person's own commands, added in Settings and kept with their account. They sit after the assistant's own in every list. The list is module state, because the composer, the panel, and the settings page must all see one. */
export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  useSelection: boolean;
}

let customCommands: readonly SlashCommand[] = [];
let merged: readonly SlashCommand[] = SLASH_COMMANDS;
const listeners = new Set<() => void>();

/** "/name" as a command: {file} becomes the open file's path and {input} what was typed after the command (added at the end when the prompt has no place for it). */
function fromCustom(c: CustomCommand): SlashCommand {
  const wantsInput = c.prompt.includes("{input}");
  return {
    name: c.name,
    description: c.description || "Your command",
    custom: true,
    takesInput: wantsInput,
    inputHint: wantsInput ? "Type what the command needs" : undefined,
    build: (ctx, input) => {
      const withFile = c.prompt.replaceAll("{file}", ctx.activeFilePath ?? "the open file");
      const prompt = wantsInput ? withFile.replaceAll("{input}", input) : `${withFile}${also(input)}`;
      return { kind: "send", prompt, options: c.useSelection && ctx.hasSelection ? { withSelection: true } : {} };
    },
  };
}

export const BUILT_IN_NAMES: ReadonlySet<string> = new Set(SLASH_COMMANDS.map((c) => c.name));

export function setCustomCommands(list: readonly CustomCommand[]) {
  customCommands = list.filter((c) => !BUILT_IN_NAMES.has(c.name)).map(fromCustom);
  merged = [...SLASH_COMMANDS, ...customCommands];
  listeners.forEach((listener) => listener());
}

/** Every command: the assistant's own, then the person's. */
export const allCommands = () => merged;
export const subscribeCommands = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The command the text starts with ("/fix the table" gives fix and "the table"), if any. */
export function parseCommand(text: string): { command: SlashCommand; input: string } | null {
  const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const command = merged.find((c) => c.name === match[1].toLowerCase());
  return command ? { command, input: (match[2] ?? "").trim() } : null;
}

/** Commands whose name starts with, or else contains, the query. */
export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  const starts = merged.filter((c) => c.name.startsWith(q));
  const contains = merged.filter((c) => !c.name.startsWith(q) && (c.name.includes(q) || c.description.toLowerCase().includes(q)));
  return [...starts, ...contains];
}

/** Project files whose path matches the query, the closest first: name starts with it, then path contains it. */
export function filterPaths(paths: readonly string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1).toLowerCase();
  const starts = paths.filter((p) => name(p).startsWith(q));
  const contains = paths.filter((p) => !name(p).startsWith(q) && p.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}
