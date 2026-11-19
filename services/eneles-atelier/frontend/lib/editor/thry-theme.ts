import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/*
 * Thry: the editor theme in the interface's own colors, and the default.
 *
 * Unlike the other themes, which bring fixed colors of their own, this one is written against the design tokens (the grounds, the ink, the hairlines, and the ten named hues), so the editor is the same surface as the panels around it and follows the site's light and dark modes by itself, with nothing to reload.
 *
 * Its syntax colors are named for what they color, not for a hue, and are defined once in app/globals.css under `.cm-thry` (tuned again for the light mode, where each hue is deepened toward the ink so it holds on a pale ground):
 *   command    control sequences, the skeleton of a document      blue
 *   structure  sectioning, \documentclass, the title block         purple, bold
 *   name       environment names                                  teal
 *   reference  \label and \ref                                    pink
 *   citation   \cite                                              green
 *   math       the delimiters and what is between them            orange
 *   operator   & ~ \\ and other symbols that lay things out       amber
 *   string     file names and other literal arguments             green
 *   comment    comments                                           muted, italic
 *   bracket    braces and brackets                                between muted and ink
 * The same roles serve other languages opened in the editor (BibTeX, and code in general): keywords take the command color, types the name color, and so on.
 *
 * A copy of this theme, with fixed dark and light palettes for use outside the site, is kept in the owner's Thry folder (theme/).
 */

const chrome = EditorView.theme({
  "&": { color: "var(--foreground)", backgroundColor: "var(--background)" },
  ".cm-content": { caretColor: "var(--foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--thry-selection)" },
  ".cm-activeLine": { backgroundColor: "var(--thry-active-line)" },
  ".cm-gutters": { backgroundColor: "var(--background)", color: "var(--thry-gutter)", border: "none" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--thry-gutter)" },
  ".cm-selectionMatch": { backgroundColor: "var(--thry-selection-match)" },
  ".cm-searchMatch": { backgroundColor: "var(--thry-search)", outline: "1px solid var(--thry-search-edge)", borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--thry-search-current)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--thry-bracket-match)", outline: "1px solid var(--line)", borderRadius: "2px" },
  "&.cm-focused .cm-nonmatchingBracket": { color: "var(--danger)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--surface)", border: "1px solid var(--line)", color: "var(--muted-foreground)", borderRadius: "var(--radius-inset)", padding: "0 6px" },
  ".cm-tooltip": { backgroundColor: "var(--panel)", color: "var(--foreground)", border: "1px solid var(--line)", borderRadius: "var(--radius-popover)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--surface-hover)", color: "var(--foreground)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--foreground)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line)" },
});

const syntax = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.moduleKeyword, t.modifier], color: "var(--thry-command)" },
  { tag: [t.definitionKeyword, t.heading], color: "var(--thry-structure)", fontWeight: "600" },
  { tag: [t.className, t.typeName, t.namespace, t.tagName], color: "var(--thry-name)" },
  { tag: [t.labelName, t.attributeName], color: "var(--thry-reference)" },
  { tag: [t.quote, t.link, t.url], color: "var(--thry-citation)" },
  { tag: [t.processingInstruction, t.number, t.bool, t.atom, t.null, t.constant(t.variableName)], color: "var(--thry-math)" },
  { tag: [t.variableName, t.special(t.variableName), t.regexp], color: "var(--thry-math-text)" },
  { tag: [t.function(t.variableName), t.macroName, t.propertyName], color: "var(--thry-command)" },
  { tag: [t.operator, t.escape], color: "var(--thry-operator)" },
  { tag: [t.string, t.special(t.string), t.character], color: "var(--thry-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--thry-comment)", fontStyle: "italic" },
  { tag: [t.bracket, t.punctuation, t.separator], color: "var(--thry-bracket)" },
  { tag: t.meta, color: "var(--muted-foreground)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, color: "var(--thry-string)" },
  { tag: t.invalid, color: "var(--danger)", textDecoration: "underline wavy" },
]);

/** The Thry editor theme. One extension for both modes: the colors come from the page's tokens. */
export const thry: Extension = [EditorView.editorAttributes.of({ class: "cm-thry" }), chrome, syntaxHighlighting(syntax)];
