/**
 * How visual mode looks. The document is set as a page: a serif face (KaTeX's Computer Modern, which the app already loads for math) in the theme's foreground on its background, in a centered column with a reading measure. The interface pieces inside it (markers, chips, the preamble row) use the interface face and the app's tokens, so both themes follow.
 */
import { EditorView } from "@codemirror/view";

const SERIF = `"KaTeX_Main", "Latin Modern Roman", "CMU Serif", Georgia, "Times New Roman", serif`;
const SANS = "var(--font-inter), ui-sans-serif, system-ui, sans-serif";
const MONO = "var(--font-jetbrains-mono), ui-monospace, monospace";

const chip = {
  fontFamily: SANS,
  fontStyle: "normal",
  fontWeight: "500",
  fontSize: "0.74em",
  lineHeight: "1.5",
  padding: "1px 6px",
  margin: "0 1px",
  borderRadius: "var(--radius-inset)",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  color: "var(--muted-foreground)",
  verticalAlign: "0.12em",
  cursor: "text",
  boxDecorationBreak: "clone",
  WebkitBoxDecorationBreak: "clone",
};

const row = {
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  width: "100%",
  boxSizing: "border-box",
  minHeight: "var(--control-height)",
  padding: "0 12px",
  margin: "3px 0",
  fontFamily: SANS,
  fontStyle: "normal",
  fontWeight: "400",
  fontSize: "14px",
  lineHeight: "20px",
  color: "var(--muted-foreground)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-item)",
  background: "transparent",
  textAlign: "left",
  verticalAlign: "middle",
};

export const visualTheme = EditorView.theme({
  // ── The page ──
  "&.cm-visual": { backgroundColor: "var(--background)", color: "var(--foreground)" },
  "&.cm-visual .cm-scroller": { fontFamily: SERIF },
  "&.cm-visual .cm-content": {
    fontFamily: SERIF,
    fontSize: "1.2em",
    lineHeight: "1.7",
    maxWidth: "44em",
    minWidth: "0",
    margin: "0 auto",
    padding: "28px 0 35vh",
    // The side margin sits on each line, not on the content, so a selection's highlight stops where the text does.
    // A fixed length: the column is centered by its maximum width, so this only shows when the panel is narrow. (A container-relative length here cost 4 ms a keystroke in a long file.)
    "--v-gutter": "20px",
    caretColor: "var(--foreground)",
    color: "var(--foreground)",
  },
  "&.cm-visual .cm-line": {
    paddingLeft: "calc(var(--v-gutter) + var(--v-pad, 0em)) !important",
    paddingRight: "var(--v-gutter)",
    textIndent: "var(--v-indent, 0) !important",
  },
  // The syntax colors of code mode give way to the page's own; source shown for editing keeps one quiet color.
  "&.cm-visual .cm-line span:not([class*='cm-'])": { color: "inherit", fontStyle: "inherit", fontWeight: "inherit" },
  "&.cm-visual .cm-cursor, &.cm-visual .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-visual .cm-selectionBackground, &.cm-visual.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: "color-mix(in oklch, var(--hue-blue) 26%, transparent)",
  },
  "&.cm-visual .cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-visual .cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--muted-foreground)" },
  "&.cm-visual .cm-gutter.cm-lineNumbers": { display: "none !important" },
  "&.cm-visual .cm-activeLineGutter": { backgroundColor: "transparent" },
  "&.cm-visual .cm-foldGutter .cm-gutterElement": { paddingInline: "4px" },
  "&.cm-visual .cm-matchingBracket, &.cm-visual .cm-nonmatchingBracket": { backgroundColor: "transparent", outline: "none" },
  ".cm-v-w": { textIndent: "0" },
  // CodeMirror puts zero-width images beside inline widgets so a native caret can sit next to them. Chrome breaks lines at those images, which split a chip from its full stop. In visual mode the cursor never rests beside a drawn widget (touching one shows its source), so they can go.
  "&.cm-visual .cm-widgetBuffer": { display: "none" },

  // A line whose source is all hidden (\begin{itemize}, \centering) keeps a sliver of height, so the cursor can still reach it.
  "&.cm-visual .cm-line.cm-v-collapsed": { fontSize: "0", lineHeight: "8px", height: "8px", overflow: "hidden" },

  // ── Headings ──
  ".cm-v-h": { fontWeight: "700", lineHeight: "1.3", letterSpacing: "-0.005em" },
  "&.cm-visual .cm-line.cm-v-hp, &.cm-visual .cm-line.cm-v-h0": { fontSize: "1.8em", paddingTop: "0.9em", paddingBottom: "0.3em" },
  "&.cm-visual .cm-line.cm-v-h1": { fontSize: "1.42em", paddingTop: "0.85em", paddingBottom: "0.15em" },
  "&.cm-visual .cm-line.cm-v-h2": { fontSize: "1.2em", paddingTop: "0.7em" },
  "&.cm-visual .cm-line.cm-v-h3": { fontSize: "1.05em", paddingTop: "0.55em" },
  ".cm-v-number": { color: "var(--muted-foreground)", marginRight: "0.65em", fontVariantNumeric: "tabular-nums" },
  "&.cm-visual .cm-line.cm-v-frametitle": { fontSize: "1.2em", fontWeight: "700", lineHeight: "1.35" },
  "&.cm-visual .cm-line.cm-v-framesubtitle": { color: "var(--muted-foreground)" },

  // ── Text ──
  ".cm-v-bold": { fontWeight: "700" },
  ".cm-v-italic": { fontStyle: "italic" },
  ".cm-v-italic-body": { fontStyle: "italic" },
  ".cm-v-italic-body .cm-v-italic, .cm-v-italic .cm-v-italic": { fontStyle: "normal" },
  ".cm-v-plain": { fontStyle: "normal", fontWeight: "400" },
  ".cm-v-underline": { textDecoration: "underline", textUnderlineOffset: "0.15em" },
  ".cm-v-strike": { textDecoration: "line-through" },
  ".cm-v-mono": { fontFamily: MONO, fontSize: "0.86em" },
  ".cm-v-sans": { fontFamily: SANS, fontSize: "0.92em" },
  ".cm-v-smallcaps": { fontVariant: "small-caps", letterSpacing: "0.02em" },
  ".cm-v-sup": { verticalAlign: "super", fontSize: "0.72em", lineHeight: "0" },
  ".cm-v-sub": { verticalAlign: "sub", fontSize: "0.72em", lineHeight: "0" },
  ".cm-v-highlight": { backgroundColor: "color-mix(in oklch, var(--hue-amber) 32%, transparent)", borderRadius: "2px" },
  ".cm-v-size-xs": { fontSize: "0.75em" },
  ".cm-v-size-sm": { fontSize: "0.9em" },
  ".cm-v-size-lg": { fontSize: "1.15em" },
  ".cm-v-size-xl": { fontSize: "1.35em" },
  ".cm-v-size-xxl": { fontSize: "1.6em" },
  ".cm-v-link": { color: "var(--hue-blue)", textDecoration: "underline", textDecorationColor: "color-mix(in oklch, var(--hue-blue) 45%, transparent)", textUnderlineOffset: "0.18em" },
  ".cm-v-comment": { fontFamily: MONO, fontSize: "0.78em", fontStyle: "normal", fontWeight: "400", color: "var(--muted-foreground)" },
  ".cm-v-logo": { whiteSpace: "nowrap" },
  ".cm-v-logo-a": { fontSize: "0.72em", verticalAlign: "0.22em", marginLeft: "-0.3em", marginRight: "-0.12em" },
  ".cm-v-logo-e": { verticalAlign: "-0.5ex", marginLeft: "-0.1667em", marginRight: "-0.125em" },
  ".cm-v-and": { display: "inline-block", width: "2.2em" },
  ".cm-v-break": { fontFamily: SANS, fontSize: "0.7em", color: "var(--muted-foreground)", margin: "0 0.2em", verticalAlign: "0.1em" },

  // Source shown because the cursor is in it.
  ".cm-v-markup, .cm-v-unknown": { fontFamily: MONO, fontSize: "0.8em", fontStyle: "normal", fontWeight: "400", color: "var(--muted-foreground)" },
  ".cm-v-unbalanced": { textDecoration: "underline dotted", textDecorationColor: "var(--warning)", textUnderlineOffset: "0.2em" },
  ".cm-v-math-source": { fontFamily: MONO, fontSize: "0.82em", fontStyle: "normal", fontWeight: "400", background: "var(--surface)", borderRadius: "var(--radius-inset)", padding: "1px 2px" },
  ".cm-v-cite-source": { fontFamily: MONO, fontSize: "0.8em", color: "var(--hue-teal)" },
  ".cm-v-ref-source": { fontFamily: MONO, fontSize: "0.8em", color: "var(--hue-blue)" },
  "&.cm-visual .cm-line.cm-v-source": { fontFamily: MONO, fontSize: "0.78em", lineHeight: "1.65", color: "var(--muted-foreground)", fontStyle: "normal", fontWeight: "400", textAlign: "left !important" },
  // A panel behind source lines that stays inside the page's column.
  "&.cm-visual .cm-line.cm-v-source-math, &.cm-visual .cm-line.cm-v-code": {
    backgroundImage: "linear-gradient(var(--panel), var(--panel))",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "var(--v-gutter) 0",
    backgroundSize: "calc(100% - 2 * var(--v-gutter)) 100%",
  },
  "&.cm-visual .cm-line.cm-v-source-math": { color: "var(--foreground)" },
  "&.cm-visual .cm-line.cm-v-ignored": { opacity: "0.7" },
  "&.cm-visual .cm-line.cm-v-code": { fontFamily: MONO, fontSize: "0.78em", lineHeight: "1.65", fontStyle: "normal", textAlign: "left !important", paddingLeft: "calc(var(--v-gutter) + var(--v-pad, 0em) + 12px) !important", paddingRight: "calc(var(--v-gutter) + 12px)" },

  // ── Math ──
  ".cm-v-math": { cursor: "text" },
  ".cm-v-math .katex": { fontSize: "1.04em" },
  ".cm-v-math-error": { fontFamily: MONO, fontSize: "0.82em", color: "var(--muted-foreground)", textDecoration: "underline dotted", textDecorationColor: "var(--danger)" },
  ".cm-v-display": { display: "inline-block", width: "100%", maxWidth: "100%", boxSizing: "border-box", padding: "0.35em 0", textAlign: "center", cursor: "text", fontStyle: "normal" },
  // KaTeX's tags reach 2px past their box; the padding keeps that from showing a scrollbar.
  ".cm-v-display-math": { display: "block", overflowX: "auto", overflowY: "hidden", padding: "0 4px" },
  ".cm-v-display .katex-display, .cm-v-preview .katex-display": { margin: "0" },
  ".cm-v-display .katex, .cm-v-preview .katex": { fontSize: "1.04em" },
  ".cm-v-display .katex-tag, .cm-v-preview .katex-tag": { color: "var(--muted-foreground)" },
  // Room for the equation number on both sides, so a narrow column scrolls the equation instead of printing the number over it.
  ".cm-v-display .katex-display > .katex > .katex-html:has(> .katex-tag), .cm-v-preview .katex-display > .katex > .katex-html:has(> .katex-tag)": { display: "inline-block", minWidth: "100%", boxSizing: "border-box", paddingInline: "3.2em" },
  ".cm-v-display-error": { textAlign: "left", border: "1px dashed var(--line)", borderRadius: "var(--radius-item)", padding: "8px 12px" },
  ".cm-v-display-note": { display: "block", fontFamily: SANS, fontSize: "13px", lineHeight: "18px", color: "var(--muted-foreground)" },
  ".cm-v-display-source": { display: "block", fontFamily: MONO, fontSize: "0.78em", whiteSpace: "pre-wrap" },
  ".cm-v-preview": { marginInline: "var(--v-gutter)", padding: "10px 0", textAlign: "center", backgroundColor: "var(--panel)", borderTop: "1px dashed var(--line)", fontFamily: SERIF, cursor: "default", overflowX: "auto", overflowY: "hidden", paddingInline: "4px" },

  // ── Chips ──
  ".cm-v-chip": chip,
  ".cm-v-cite": { color: "var(--hue-teal)" },
  ".cm-v-ref": { color: "var(--hue-blue)" },
  ".cm-v-ref-unknown": { color: "var(--muted-foreground)", borderStyle: "dashed" },
  ".cm-v-label": { fontSize: "0.68em", background: "transparent", borderStyle: "dashed" },
  ".cm-v-macro-chip": { fontFamily: MONO, fontWeight: "400" },
  ".cm-v-footnote-mark": { fontFamily: SANS, fontStyle: "normal", fontWeight: "600", fontSize: "0.68em", color: "var(--hue-blue)", padding: "0 2px", cursor: "help", lineHeight: "0" },
  ".cm-v-footnote-text": { color: "var(--muted-foreground)", fontSize: "0.9em" },

  // ── Lists ──
  "&.cm-visual .cm-line.cm-v-item-line": { "--v-indent": "-1.75em" },
  ".cm-v-bullet": { display: "inline-block", minWidth: "1.75em", whiteSpace: "nowrap", boxSizing: "border-box", paddingRight: "0.6em", textAlign: "right", color: "var(--muted-foreground)", fontStyle: "normal", fontVariantNumeric: "tabular-nums" },
  ".cm-v-term": { fontWeight: "700", fontStyle: "normal", marginRight: "0.5em", marginLeft: "1.75em" },

  // ── Environments ──
  "&.cm-visual .cm-line.cm-v-ruled": {
    backgroundImage: "linear-gradient(color-mix(in oklch, var(--hue-blue) 55%, transparent), color-mix(in oklch, var(--hue-blue) 55%, transparent))",
    backgroundSize: "2px 100%",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "calc(var(--v-gutter) + var(--v-rule, 0em)) 0",
  },
  "&.cm-visual .cm-line.cm-v-ruled-proof": { backgroundImage: "linear-gradient(var(--line), var(--line))" },
  "&.cm-visual .cm-line.cm-v-ruled-generic": { backgroundImage: "repeating-linear-gradient(to bottom, var(--line) 0 4px, transparent 4px 7px)" },
  "&.cm-visual .cm-line.cm-v-slide": { backgroundImage: "linear-gradient(var(--line), var(--line))", backgroundSize: "3px 100%" },
  "&.cm-visual .cm-line.cm-v-slide, &.cm-visual .cm-line.cm-v-blockenv": { backgroundRepeat: "no-repeat" },
  "&.cm-visual .cm-line.cm-v-blockenv": { backgroundImage: "linear-gradient(color-mix(in oklch, var(--hue-teal) 60%, transparent), color-mix(in oklch, var(--hue-teal) 60%, transparent))" },
  ".cm-v-envlabel": { fontStyle: "normal" },
  ".cm-v-envlabel-theorem .cm-v-envlabel-title": { fontWeight: "700" },
  ".cm-v-envlabel-proof": { fontStyle: "italic" },
  ".cm-v-envlabel-abstract": { display: "inline-block", width: "100%", textAlign: "center", fontWeight: "700", fontSize: "0.92em", letterSpacing: "0.01em" },
  ".cm-v-envlabel-frame": { fontWeight: "700", fontSize: "1.15em" },
  ".cm-v-envlabel-block": { fontWeight: "700" },
  ".cm-v-envlabel-generic, .cm-v-envlabel-code": { fontFamily: SANS, fontSize: "13px", lineHeight: "18px", fontWeight: "500", color: "var(--muted-foreground)" },
  ".cm-v-envlabel-generic .cm-v-envlabel-note, .cm-v-envlabel-code .cm-v-envlabel-note": { fontFamily: MONO, fontWeight: "400", marginLeft: "0.5em" },
  ".cm-v-qed": { display: "inline-block", width: "100%", textAlign: "right", color: "var(--muted-foreground)", fontStyle: "normal" },
  "&.cm-visual .cm-line.cm-v-quote": { paddingRight: "calc(var(--v-gutter) + 1.5em)", color: "color-mix(in oklch, var(--foreground) 85%, var(--muted-foreground))" },
  "&.cm-visual .cm-line.cm-v-abstract": { paddingLeft: "calc(var(--v-gutter) + var(--v-pad, 0em) + 2.5em) !important", paddingRight: "calc(var(--v-gutter) + 2.5em)", fontSize: "0.94em" },
  "&.cm-visual .cm-line.cm-v-center": { textAlign: "center" },
  "&.cm-visual .cm-line.cm-v-right": { textAlign: "right" },

  // ── Figures and tables ──
  "&.cm-visual .cm-line.cm-v-figure-line": { textAlign: "center" },
  "&.cm-visual .cm-line.cm-v-caption-line": { fontSize: "0.92em", lineHeight: "1.55", padding: "0.2em 0 0.4em" },
  ".cm-v-caption-lead": { fontWeight: "700", marginRight: "0.4em" },
  ".cm-v-image": { display: "inline-block", maxWidth: "100%", padding: "6px 0", verticalAlign: "top" },
  ".cm-v-image img": { maxWidth: "100%", maxHeight: "360px", borderRadius: "var(--radius-inset)", verticalAlign: "top", background: "var(--paper)" },
  ".cm-v-image-missing": { fontFamily: SANS, fontSize: "13px", lineHeight: "18px", color: "var(--muted-foreground)", border: "1px dashed var(--line)", borderRadius: "var(--radius-item)", padding: "10px 14px", margin: "4px 0" },
  ".cm-v-table": { display: "inline-block", width: "100%", maxWidth: "100%", boxSizing: "border-box", overflowX: "auto", padding: "0.4em 0", verticalAlign: "top", fontStyle: "normal" },
  ".cm-v-table table": { borderCollapse: "collapse", margin: "0 auto", fontSize: "0.9em", lineHeight: "1.45" },
  ".cm-v-table td": { padding: "0.22em 0.8em", whiteSpace: "nowrap" },
  ".cm-v-table td.cm-v-align-c": { textAlign: "center" },
  ".cm-v-table td.cm-v-align-r": { textAlign: "right" },
  ".cm-v-table td.cm-v-align-l": { textAlign: "left" },
  ".cm-v-table tr.cm-v-rule-thick > td": { borderTop: "1.5px solid color-mix(in oklch, var(--foreground) 70%, transparent)" },
  ".cm-v-table tr.cm-v-rule-thin > td": { borderTop: "1px solid color-mix(in oklch, var(--foreground) 40%, transparent)" },
  ".cm-v-table td.cm-v-rule-partial": { borderTop: "1px solid color-mix(in oklch, var(--foreground) 30%, transparent)" },
  ".cm-v-table tr.cm-v-rule-bottom-thick > td": { borderBottom: "1.5px solid color-mix(in oklch, var(--foreground) 70%, transparent)" },
  ".cm-v-table tr.cm-v-rule-bottom-thin > td": { borderBottom: "1px solid color-mix(in oklch, var(--foreground) 40%, transparent)" },

  // ── The title block ──
  ".cm-v-title": { display: "inline-block", width: "100%", textAlign: "center", padding: "0.8em 0 1.2em", fontStyle: "normal", lineHeight: "1.4" },
  ".cm-v-title-main": { display: "block", fontSize: "1.55em", fontWeight: "700", lineHeight: "1.25", letterSpacing: "-0.01em" },
  ".cm-v-title-sub": { display: "block", marginTop: "0.35em", color: "var(--muted-foreground)" },
  ".cm-v-title-authors": { display: "block", marginTop: "0.9em", fontSize: "1.02em" },
  ".cm-v-title-date": { display: "block", marginTop: "0.45em", color: "var(--muted-foreground)" },
  ".cm-v-title-empty": { fontFamily: SANS, fontSize: "13px", color: "var(--muted-foreground)" },

  // ── Quiet rows ──
  ".cm-v-marker": row,
  ".cm-v-marker-label": { color: "var(--foreground)", fontWeight: "500", whiteSpace: "nowrap" },
  ".cm-v-marker-detail": { fontFamily: MONO, fontSize: "13px", lineHeight: "18px", color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 auto", minWidth: "0" },
  "button.cm-v-marker": { cursor: "pointer" },
  "button.cm-v-marker:hover": { background: "var(--surface-hover)", borderColor: "var(--line)" },
  "button.cm-v-marker:focus-visible": { outline: "2px solid var(--focus)", outlineOffset: "2px" },
  ".cm-v-marker-hint": { marginLeft: "auto", flex: "none", color: "var(--muted-foreground)", fontSize: "13px", lineHeight: "18px" },
  "button.cm-v-marker:hover .cm-v-marker-hint": { color: "var(--foreground)" },
  ".cm-v-marker-quiet": { border: "none", background: "transparent", padding: "0", minHeight: "0", margin: "0", fontSize: "13px", lineHeight: "18px" },
  ".cm-v-marker-quiet .cm-v-marker-label": { color: "var(--muted-foreground)", fontWeight: "400" },
  ".cm-v-marker-divider, .cm-v-marker-page": { border: "none", background: "transparent", padding: "0", justifyContent: "center", gap: "12px" },
  ".cm-v-marker-divider::before, .cm-v-marker-divider::after, .cm-v-marker-page::before, .cm-v-marker-page::after": { content: "''", flex: "1 1 0", borderTop: "1px solid var(--line)" },
  ".cm-v-marker-page::before, .cm-v-marker-page::after": { borderTopStyle: "dashed" },
  ".cm-v-marker-divider .cm-v-marker-label, .cm-v-marker-page .cm-v-marker-label": { color: "var(--muted-foreground)", fontWeight: "500" },
  ".cm-v-folded": { ...row, borderStyle: "dashed", background: "transparent", cursor: "text" },

  // ── The preamble row ──
  ".cm-v-preamble": { display: "inline-block", width: "100%", verticalAlign: "top", padding: "0 0 8px", fontStyle: "normal" },
  // Open, it is a block above the first line, outside any line's margins.
  ".cm-v-preamble-open": { display: "block", width: "auto", margin: "0 var(--v-gutter)", paddingBottom: "4px" },
  ".cm-v-preamble-button": {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    height: "var(--control-height)",
    padding: "0 12px",
    fontFamily: SANS,
    fontSize: "14px",
    lineHeight: "20px",
    color: "var(--muted-foreground)",
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-item)",
    cursor: "pointer",
    textAlign: "left",
  },
  ".cm-v-preamble-button:hover": { background: "var(--surface-hover)" },
  ".cm-v-preamble-button:focus-visible": { outline: "2px solid var(--focus)", outlineOffset: "2px" },
  ".cm-v-preamble-label": { color: "var(--foreground)", fontWeight: "500" },
  ".cm-v-preamble-count": { fontFamily: MONO, fontSize: "13px" },
  ".cm-v-preamble-hint": { marginLeft: "auto" },
  ".cm-v-chevron": { width: "7px", height: "7px", borderRight: "1.5px solid currentColor", borderBottom: "1.5px solid currentColor", transform: "rotate(-45deg)", margin: "0 2px 0 0", flex: "none" },
  ".cm-v-preamble-open .cm-v-chevron": { transform: "rotate(45deg) translate(-2px, -1px)" },
});
