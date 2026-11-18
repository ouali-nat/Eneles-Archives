// Shared types for the Eneles PowerPoint add-in.

export type TexEngine = "pdflatex" | "xelatex" | "lualatex";
export type FontMode = "path" | "embed";
export type RenderMode = "quick" | "full";
export type ColorTheme = "light" | "dark";
export type TabName = "recents" | "saved" | "settings" | "info";
export type Workspace = "math" | "latex" | "boxes" | "tikz";
/** Backdrop shown behind the preview only. "slide" follows the Look's paper. */
export type PreviewBackground = "slide" | "checker" | "white" | "black";
/** The slide the render is going onto. Independent of the pane's own theme. */
export type SlidePreset = "light" | "dark" | "custom";
export type FontId = "cm" | "lm" | "palatino" | "times" | "libertine" | "sans" | "system";
export type BoxStyle = "bar" | "frame" | "rounded" | "titlebar" | "plain";

export interface Settings {
  /** Base URL of the local compile server, e.g. http://127.0.0.1:47822 */
  serverUrl: string;
  /** Token printed by the local server on startup. */
  serverToken: string;
  engine: TexEngine;
  fontMode: FontMode;
  border: string;
  /** Extra preamble lines (macros, \usetikzlibrary, ...) applied to every full-LaTeX render. */
  extraPreamble: string;
  /** Default mode the editor opens in. */
  defaultMode: RenderMode;
  /** The task pane's own colours. Never affects what gets inserted. */
  theme: ColorTheme;
  /** The Look: one ink/paper/font for every workspace. See core/look.ts. */
  slidePreset: SlidePreset;
  ink: string;
  paper: string;
  font: FontId;
  /** Installed font name used when font is "system". */
  fontName: string;
  boxAutoNumber: boolean;
  /** Backdrop behind the preview, for checking a render against the slide. */
  previewBackground: PreviewBackground;
  /** Preview and insert size, percent. */
  mathScale: number;
  /** Extra horizontal tracking, percent. 0 is unchanged. */
  mathSpacing: number;
  /** Physical width, in inches, used when inserting into the slide. */
  insertWidthIn: number;
  /** Raster scale multiplier applied on top of insertWidthIn (crispness vs. file size). */
  rasterScale: number;
  transparentBackground: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "http://127.0.0.1:47822",
  serverToken: "",
  engine: "pdflatex",
  fontMode: "path",
  border: "2pt",
  extraPreamble: "",
  defaultMode: "quick",
  theme: "light",
  slidePreset: "light",
  ink: "#171717",
  paper: "#FFFFFF",
  font: "cm",
  fontName: "",
  boxAutoNumber: true,
  previewBackground: "slide",
  mathScale: 100,
  mathSpacing: 0,
  insertWidthIn: 3,
  rasterScale: 4,
  transparentBackground: true,
};

export interface CompileSvgRequest {
  source: string;
  engine: TexEngine;
  preamble: string;
  border: string;
  fontMode: FontMode;
}

export interface CompileSvgResult {
  success: boolean;
  svg: string | null;
  /** The compiled PDF, base64. Present from servers that support PDF export. */
  pdf?: string | null;
  log?: string;
  errors: string[];
  duration?: number;
}

export interface ServerHealth {
  ok: boolean;
  engines: TexEngine[];
  svgTool: "dvisvgm" | "pdftocairo" | null;
}

export interface HistoryEntry {
  id: string;
  source: string;
  mode: RenderMode;
  createdAt: number;
}

export interface SavedSnippet {
  id: string;
  label: string;
  workspace: Workspace;
  source: string;
}

export interface BoxPreset {
  name: string;
  label: string;
  style: BoxStyle;
  accent: string;
  fill: string;
}

/** What a Eneles picture carries in its shape tag, so it can be edited and re-rendered later. */
export interface ShapeMeta {
  v: 1;
  source: string;
  workspace: Workspace;
  engine: TexEngine;
  displayMath: boolean;
  box?: import("./boxes").BoxFields;
  boxEdited?: boolean;
  /** Width in points it was inserted at, to carry the user's manual resizing through a replace. */
  insertedWidth?: number;
}
