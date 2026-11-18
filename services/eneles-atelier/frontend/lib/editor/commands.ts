/**
 * Editor commands, snippets, and keyboard shortcuts.
 * Used by Command Palette (Ctrl+K) and Shortcuts reference dialog.
 */

import { tikzLibraries } from "../tikz/libraries";
import { LATEX_SNIPPETS } from "../latex/snippets";

export type CommandCategory = "snippet" | "tikz" | "action";

export interface EditorCommand {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  keywords: string[];
  /** For snippet/tikz: LaTeX to insert. For action: ignored */
  template?: string;
  /** For action: identifier to dispatch */
  action?: string;
  shortcut?: string;
}

/** LaTeX snippets as commands */
const snippetCommands: EditorCommand[] = LATEX_SNIPPETS.map((s) => ({
  id: `snippet-${s.label.toLowerCase().replace(/\s+/g, "-")}`,
  label: s.label,
  description: s.description,
  category: "snippet",
  keywords: [s.label, s.category, ...(s.description?.split(" ") ?? [])],
  template: s.template,
}));

/** TikZ examples from libraries */
const tikzCommands: EditorCommand[] = tikzLibraries.flatMap((lib) =>
  lib.examples.map((ex) => ({
    id: `tikz-${lib.id}-${ex.id}`,
    label: ex.name,
    description: `${lib.name}: ${ex.description}`,
    category: "tikz",
    keywords: [
      ex.name,
      lib.name,
      ...ex.tags,
      ...(ex.description?.split(" ") ?? []),
    ],
    template: ex.source,
  })),
);

/** Editor actions (compile, save, etc.) */
const actionCommands: EditorCommand[] = [
  {
    id: "compile",
    label: "Compile",
    category: "action",
    keywords: ["compile", "build", "pdf"],
    action: "compile",
    shortcut: "Ctrl+Enter",
  },
  {
    id: "save",
    label: "Save",
    category: "action",
    keywords: ["save", "write"],
    action: "save",
    shortcut: "Ctrl+S",
  },
  {
    id: "toggle-file-tree",
    label: "Show or hide Files",
    category: "action",
    keywords: ["sidebar", "files", "panel", "tree"],
    action: "toggleFileTree",
  },
  {
    id: "toggle-pdf",
    label: "Show or hide the PDF",
    category: "action",
    keywords: ["pdf", "preview", "panel"],
    action: "togglePdf",
  },
  {
    id: "toggle-logs",
    label: "Show or hide Logs",
    category: "action",
    keywords: ["log", "error", "panel"],
    action: "toggleLogs",
  },
  {
    id: "toggle-assistant",
    label: "Show or hide Axya",
    category: "action",
    keywords: ["axya", "assistant", "ai", "panel"],
    action: "toggleAssistant",
  },
  {
    id: "toggle-review",
    label: "Show or hide Review",
    category: "action",
    keywords: ["review", "comments", "suggestions", "panel"],
    action: "toggleReview",
  },
  {
    id: "file-history",
    label: "Show the history of this file",
    category: "action",
    keywords: ["history", "versions", "changes", "restore", "diff"],
    action: "fileHistory",
  },
  {
    id: "toggle-chat",
    label: "Show or hide Chat",
    category: "action",
    keywords: ["chat", "messages", "panel"],
    action: "toggleChat",
  },
  {
    id: "reset-layout",
    label: "Reset the layout",
    category: "action",
    keywords: ["layout", "panels", "default", "reset"],
    action: "resetLayout",
  },
  {
    id: "toggle-drawing",
    label: "Open the drawing tool",
    category: "action",
    keywords: ["draw", "tikz", "canvas"],
    action: "toggleDrawing",
  },
  {
    id: "open-settings",
    label: "Open settings",
    category: "action",
    keywords: ["settings", "preferences"],
    action: "openSettings",
  },
];

export const ALL_COMMANDS: EditorCommand[] = [
  ...actionCommands,
  ...snippetCommands,
  ...tikzCommands,
];

/** Snippets and TikZ only (no actions), for Insert Palette */
export const INSERT_COMMANDS: EditorCommand[] = [
  ...snippetCommands,
  ...tikzCommands,
];

/** Search insertable commands (snippets + TikZ) by query */
export function searchInsertCommands(query: string): EditorCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return INSERT_COMMANDS;
  const terms = q.split(/\s+/).filter(Boolean);
  return INSERT_COMMANDS.filter((cmd) => {
    const searchable = [cmd.label, cmd.description, ...cmd.keywords]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => searchable.includes(t));
  });
}

/** Search commands by query (fuzzy match on label, keywords, description) */
export function searchCommands(query: string): EditorCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_COMMANDS;
  const terms = q.split(/\s+/).filter(Boolean);
  return ALL_COMMANDS.filter((cmd) => {
    const searchable = [cmd.label, cmd.description, ...cmd.keywords]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => searchable.includes(t));
  });
}

/** LaTeX environments for Edit menu (equation, align, tabular, etc.) */
export const LATEX_ENVIRONMENTS = [
  {
    label: "Equation",
    template: "\\begin{equation}\n  \n\\end{equation}",
    shortcut: undefined,
  },
  {
    label: "Align",
    template: "\\begin{align}\n  a &= b + c \\\\\n  d &= e + f\n\\end{align}",
    shortcut: undefined,
  },
  {
    label: "Tabular",
    template:
      "\\begin{tabular}{|c|c|}\n  \\hline\n  A & B \\\\\n  \\hline\n\\end{tabular}",
    shortcut: undefined,
  },
  {
    label: "Matrix",
    template: "\\begin{bmatrix}\n  a & b \\\\\n  c & d\n\\end{bmatrix}",
    shortcut: undefined,
  },
  {
    label: "Cases",
    template:
      "\\begin{cases}\n  f(x) & \\text{if } x \\geq 0 \\\\\n  g(x) & \\text{if } x < 0\n\\end{cases}",
    shortcut: undefined,
  },
  {
    label: "Theorem",
    template: "\\begin{theorem}\n  \n\\end{theorem}",
    shortcut: undefined,
  },
  {
    label: "Figure",
    template:
      "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}",
    shortcut: undefined,
  },
  {
    label: "Table",
    template:
      "\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{|c|c|}\n    \\hline\n    A & B \\\\\n    \\hline\n  \\end{tabular}\n  \\caption{}\n\\end{table}",
    shortcut: undefined,
  },
] as const;

/** Keyboard shortcuts for the Shortcuts dialog */
export interface ShortcutEntry {
  keys: string;
  keysMac?: string;
  description: string;
  category: string;
}

export const KEYBOARD_SHORTCUTS: ShortcutEntry[] = [
  {
    keys: "Ctrl+K",
    keysMac: "⌘K",
    description: "Open command palette",
    category: "General",
  },
  {
    keys: "Shift+Space",
    keysMac: "⇧Space",
    description: "Insert snippet or TikZ",
    category: "General",
  },
  { keys: "Ctrl+S", keysMac: "⌘S", description: "Save", category: "File" },
  {
    keys: "Ctrl+Enter",
    keysMac: "⌘Enter",
    description: "Compile",
    category: "File",
  },
  { keys: "Ctrl+Z", keysMac: "⌘Z", description: "Undo", category: "Editing" },
  { keys: "Ctrl+Y", keysMac: "⌘⇧Z", description: "Redo", category: "Editing" },
  {
    keys: "Ctrl+B",
    keysMac: "⌘B",
    description: "Bold (wrap selection)",
    category: "Formatting",
  },
  {
    keys: "Ctrl+I",
    keysMac: "⌘I",
    description: "Italic (wrap selection)",
    category: "Formatting",
  },
  {
    keys: "Ctrl+/",
    keysMac: "⌘/",
    description: "Toggle comment",
    category: "Editing",
  },
  {
    keys: "Ctrl+D",
    keysMac: "⌘D",
    description: "Delete line",
    category: "Editing",
  },
  {
    keys: "Ctrl+A",
    keysMac: "⌘A",
    description: "Select all",
    category: "Editing",
  },
  { keys: "Ctrl+F", keysMac: "⌘F", description: "Find", category: "Search" },
  {
    keys: "Ctrl+G",
    keysMac: "⌘G",
    description: "Find next",
    category: "Search",
  },
  {
    keys: "Ctrl+Shift+G",
    keysMac: "⌘⇧G",
    description: "Find previous",
    category: "Search",
  },
  {
    keys: "Ctrl+Home",
    keysMac: "⌘↑",
    description: "Go to start of document",
    category: "Navigation",
  },
  {
    keys: "Ctrl+End",
    keysMac: "⌘↓",
    description: "Go to end of document",
    category: "Navigation",
  },
  {
    keys: "Ctrl+Shift+L",
    keysMac: "⌘⇧L",
    description: "Go to line",
    category: "Navigation",
  },
  {
    keys: "Ctrl+Shift+Enter",
    keysMac: "⌘⇧Enter",
    description: "Show cursor position in PDF",
    category: "Navigation",
  },
  {
    keys: "Double-click in PDF",
    keysMac: "Double-click in PDF",
    description: "Jump to that place in the source",
    category: "Navigation",
  },
  { keys: "Tab", keysMac: "Tab", description: "Indent", category: "Editing" },
  {
    keys: "Shift+Tab",
    keysMac: "⇧Tab",
    description: "Outdent",
    category: "Editing",
  },
  {
    keys: "Alt+↑",
    keysMac: "⌥↑",
    description: "Move line up",
    category: "Editing",
  },
  {
    keys: "Alt+↓",
    keysMac: "⌥↓",
    description: "Move line down",
    category: "Editing",
  },
  {
    keys: "F2",
    keysMac: "F2",
    description: "Toggle fold",
    category: "Editing",
  },
  {
    keys: "Ctrl+Space",
    keysMac: "⌘Space",
    description: "Autocomplete",
    category: "General",
  },
];
