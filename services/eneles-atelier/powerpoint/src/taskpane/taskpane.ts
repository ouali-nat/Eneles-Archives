import {
  checkHealth,
  deleteHistoryFile,
  loadPackagedServerToken,
  LocalServerError,
  openHistoryFile,
  renderFullLatex,
  saveHistoryFile,
} from "../core/local-server-client";
import { BoxFields, buildBoxSource, boxColors, BUILTIN_PRESETS, defaultAccent, nextNumber, STYLES } from "../core/boxes";
import { loadHistory, recordHistory, removeHistoryEntry } from "../core/history";
import { loadBoxPresets, loadSnippets, removeBoxPreset, removeSnippet, saveBoxPreset, saveSnippet } from "../core/library";
import { applyLook, FONTS, needsUnicodeEngine, resolveLook, wrapMath } from "../core/look";
import { insertPngIntoSlide, insertSvgIntoSlideExperimental, isInsideOffice } from "../core/office-insert";
import {
  boxNumbers,
  getSelectedTexer,
  listTexerShapes,
  replaceShape,
  shapeApiSupported,
  tagSelected,
  TexerShape,
} from "../core/ppt-shapes";
import { QuickMathError, renderMathToSvg } from "../core/quick-math";
import { loadSettings, saveSettings } from "../core/settings";
import { insertLine, looksLikeFullLatex, SNIPPETS, TIKZ_LIBRARY_CHIPS, TIKZ_TEMPLATES } from "../core/snippets";
import { computeRasterSize, CSS_PX_PER_INCH, prepareSvgForOffice, svgToDownloadUrl, svgToPng } from "../core/svg-utils";
import {
  BoxStyle,
  FontId,
  FontMode,
  HistoryEntry,
  PreviewBackground,
  RenderMode,
  Settings,
  ShapeMeta,
  SlidePreset,
  TabName,
  TexEngine,
  Workspace,
} from "../core/types";

// Percent bounds for the box width control. The upper bound exists only to
// stop a typo turning into an enormous compile. Anything up to 500% is a
// perfectly valid box, since standalone crops to the content.
const MIN_BOX_PERCENT = 5;
const MAX_BOX_PERCENT = 500;
const SAVED_MARK = "★ ";

// Minimal stroke icons for list row actions, kept as plain path strings so
// list items can be built purely in JS without extra markup.
const ICON_COPY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_FOLDER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

let settings: Settings = loadSettings();
let mode: RenderMode = settings.defaultMode;
let activeTab: TabName = "recents";
let activeWorkspace: Workspace = mode === "quick" ? "math" : "latex";

// Per-workspace drafts. Switching Math <-> LaTeX <-> Boxes <-> TikZ swaps the
// textarea contents instead of carrying one shared buffer between them, and
// they're persisted so reopening the pane restores what you were writing in
// each one. `workspaceSourcesReady` gates the swap during boot, before the
// textarea has been seeded. Otherwise the first setWorkspace() call would
// stash an empty string over a restored draft.
const WORKSPACE_SOURCES_KEY = "texer-ppt.workspace-sources.v1";
const workspaceSources: Record<Workspace, string> = { math: "", latex: "", boxes: "", tikz: "" };
let workspaceSourcesReady = false;

// Once you hand-edit generated box source, the builder stops overwriting it
// from under you. Regenerating becomes explicit (the "Regenerate source"
// button) instead of something a stray click on a colour swatch does.
let lastGeneratedBoxSource = "";
let boxSourceDirty = false;
/** "" = automatic fill: the accent tinted toward the slide's paper. */
let boxFill = "";

function loadWorkspaceSources(): void {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_SOURCES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Record<Workspace, unknown>>;
    for (const key of ["math", "latex", "boxes", "tikz"] as Workspace[]) {
      if (typeof parsed[key] === "string") workspaceSources[key] = parsed[key] as string;
    }
  } catch {
    /* corrupt or unavailable storage just means everyone starts empty */
  }
}

function saveWorkspaceSources(): void {
  try {
    window.localStorage.setItem(WORKSPACE_SOURCES_KEY, JSON.stringify(workspaceSources));
  } catch {
    /* best-effort */
  }
}

let lastSvg: string | null = null;
let lastRawSvg: string | null = null;
let lastRawWasMathJax = false;
let lastPdf: string | null = null;
let lastSource = "";
let lastRenderKey: string | null = null;
let lastMeta: ShapeMeta | null = null;
let packagedTokenLoad: Promise<void> = Promise.resolve();

// Re-editing (PowerPointApi 1.5). `editing` is the picture loaded with
// "Edit selected"; only it can be replaced. Merely having some Eneles picture
// selected never turns an insert into an overwrite.
let shapeApi = false;
let editing: TexerShape | null = null;
let selectedTexer: TexerShape | null = null;

function applyTheme(theme: Settings["theme"]): void {
  // The pane's own colours only. The ink of what gets inserted is the Look.
  document.documentElement.classList.toggle("dark", theme === "dark");
  const toggle = document.getElementById("theme-toggle");
  if (toggle) toggle.title = theme === "dark" ? "Light" : "Dark";
}

function toggleTheme(): void {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  applyTheme(settings.theme);
  saveSettings(settings);
}

function sourceBox(): HTMLTextAreaElement {
  return el("source");
}

function setStatus(message: string, kind: "" | "ok" | "err" = ""): void {
  const node = el("status");
  node.textContent = message;
  node.className = `status${kind ? " " + kind : ""}`;
}

// ── The Look ─────────────────────────────────────────────────────

function inkHex(): string {
  return "#" + resolveLook(settings).ink;
}

function paperHex(): string {
  return "#" + resolveLook(settings).paper;
}

/** MathJax only has its own (Computer Modern-like) fonts; anything else needs TeX. */
function mathUsesMathJax(): boolean {
  return settings.font === "cm";
}

function applyLookToForm(): void {
  el<HTMLSelectElement>("slide-preset").value = settings.slidePreset;
  el<HTMLInputElement>("look-ink").value = inkHex().toLowerCase();
  el<HTMLInputElement>("look-paper").value = paperHex().toLowerCase();
  el<HTMLSelectElement>("look-font").value = settings.font;
  document.documentElement.style.setProperty("--slide-paper", paperHex());
  setPreviewBackground(settings.previewBackground, { save: false });
  showBoxFill();
}

function onLookChanged(): void {
  saveSettings(settings);
  applyLookToForm();
  if (activeWorkspace === "boxes" && !boxSourceDirty) syncBoxSource();
  setMode(activeWorkspace === "math" ? "quick" : "full", { user: false });
  if (settings.font === "system" && !settings.fontName.trim()) {
    setStatus("Set the system font's name in Settings first.", "err");
    setActiveTab("settings");
    el<HTMLInputElement>("set-font-name").focus();
    return;
  }
  setStatus(
    shapeApi
      ? "Look changed. Render to see it; Re-render all updates pictures already on slides."
      : "Look changed. Render to see it.",
  );
}

function bindLook(): void {
  const fontSelect = el<HTMLSelectElement>("look-font");
  for (const f of FONTS) {
    const option = document.createElement("option");
    option.value = f.id;
    option.textContent = f.label;
    fontSelect.append(option);
  }
  el<HTMLSelectElement>("slide-preset").addEventListener("change", () => {
    const next = el<HTMLSelectElement>("slide-preset").value as SlidePreset;
    if (next === "custom") {
      // Start Custom from whatever is showing, so nothing jumps.
      settings.ink = inkHex();
      settings.paper = paperHex();
    }
    settings.slidePreset = next;
    onLookChanged();
  });
  for (const which of ["ink", "paper"] as const) {
    el<HTMLInputElement>(`look-${which}`).addEventListener("change", () => {
      // Editing either colour makes the Look Custom, keeping the other one.
      settings.ink = inkHex();
      settings.paper = paperHex();
      settings[which] = el<HTMLInputElement>(`look-${which}`).value.toUpperCase();
      settings.slidePreset = "custom";
      onLookChanged();
    });
  }
  fontSelect.addEventListener("change", () => {
    settings.font = fontSelect.value as FontId;
    onLookChanged();
  });
}

// ── Preview backdrop ─────────────────────────────────────────────

const PREVIEW_BACKGROUNDS: PreviewBackground[] = ["slide", "checker", "white", "black"];
const PREVIEW_BACKGROUND_LABELS: Record<PreviewBackground, string> = {
  slide: "Slide",
  checker: "Transparent",
  white: "White",
  black: "Black",
};

/**
 * Preview backdrop only. "Slide" shows the Look's paper colour, so what you
 * see is what lands on the slide; the others are for spot checks. What gets
 * inserted is unaffected; that is the "Transparent background" setting.
 */
function setPreviewBackground(next: PreviewBackground, { save }: { save: boolean }): void {
  settings.previewBackground = next;
  const preview = el("preview");
  preview.classList.toggle("on-slide", next === "slide");
  preview.classList.toggle("checker", next === "checker");
  preview.classList.toggle("on-white", next === "white");
  preview.classList.toggle("on-black", next === "black");
  preview.style.backgroundColor = next === "slide" ? paperHex() : "";

  const button = el("preview-bg");
  button.dataset.bg = next;
  button.title = `Preview background: ${PREVIEW_BACKGROUND_LABELS[next]}. Click to cycle.`;
  el("preview-bg-label").textContent = PREVIEW_BACKGROUND_LABELS[next];

  if (save) saveSettings(settings);
}

function cyclePreviewBackground(): void {
  const index = PREVIEW_BACKGROUNDS.indexOf(settings.previewBackground);
  setPreviewBackground(PREVIEW_BACKGROUNDS[(index + 1) % PREVIEW_BACKGROUNDS.length], { save: true });
}

// ── Tabs, modes, workspaces ──────────────────────────────────────

function setActiveTab(tab: TabName): void {
  activeTab = tab;
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== tab);
  });
  if (tab === "recents") renderRecentsList();
  if (tab === "saved") renderSavedLists();
}

function setMode(next: RenderMode, { user }: { user: boolean }): void {
  mode = next;
  el("quick-opts").classList.toggle("hidden", next !== "quick");
  // The engine matters for math too once a non-default font sends it through TeX.
  el("full-opts").classList.toggle("hidden", next === "quick" && mathUsesMathJax());
  if (user) {
    settings.defaultMode = next;
    saveSettings(settings);
  }
}

function setWorkspace(next: Workspace, { user, keepEditing = false }: { user: boolean; keepEditing?: boolean }): void {
  if (!keepEditing) endEditing();
  // Each workspace keeps its own draft, so flipping Math -> TikZ -> Math
  // doesn't cost you what you were writing. Stash the outgoing one before
  // swapping the textarea over to the incoming one.
  if (workspaceSourcesReady && next !== activeWorkspace) {
    workspaceSources[activeWorkspace] = sourceBox().value;
    saveWorkspaceSources();
  }
  const switching = next !== activeWorkspace;

  activeWorkspace = next;
  setMode(next === "math" ? "quick" : "full", { user });

  document.querySelectorAll<HTMLButtonElement>(".mode").forEach((btn) => {
    const on = btn.dataset.workspace === next;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", String(on));
  });

  if (workspaceSourcesReady && switching) {
    sourceBox().value = workspaceSources[next] || "";
  }

  el("box-builder").classList.toggle("hidden", next !== "boxes");
  el("tikz-tools").classList.toggle("hidden", next !== "tikz");
  const sourceField = el<HTMLElement>("source-field");
  if (next === "boxes") el("box-builder").before(sourceField);
  else el("mode-hint").after(sourceField);
  renderSnippetOptions();
  if (next === "boxes") refreshAutoNumber().catch(() => undefined);

  const hints: Record<Workspace, string> = {
    math: "Equations and aligned math. Renders in the pane with the default font; other fonts use your TeX.",
    latex: "Full LaTeX source. Preamble declarations at the top are handled automatically.",
    boxes: "Theorem-style boxes with any label. Only the small tcolorbox dependency is added.",
    tikz: "Write TikZ directly, then add libraries or a starter diagram below as needed.",
  };
  el("mode-hint").textContent = hints[next];
}

function renderSnippetOptions(): void {
  const select = el<HTMLSelectElement>("snippet-select");
  const canShowExamples = activeWorkspace !== "boxes";
  select.classList.toggle("hidden", !canShowExamples);
  el("btn-save-snippet").classList.toggle("hidden", !canShowExamples);
  select.innerHTML = '<option value="">Examples</option>';
  if (!canShowExamples) return;

  for (const snippet of SNIPPETS.filter((item) => item.workspace === activeWorkspace)) {
    const option = document.createElement("option");
    option.value = `builtin:${snippet.id}`;
    option.textContent = snippet.label;
    select.append(option);
  }
  const saved = loadSnippets().filter((s) => s.workspace === activeWorkspace);
  if (saved.length) {
    const group = document.createElement("optgroup");
    group.label = "Saved";
    for (const s of saved) {
      const option = document.createElement("option");
      option.value = `saved:${s.id}`;
      option.textContent = s.label;
      group.append(option);
    }
    select.append(group);
  }
}

function currentSource(): string {
  return sourceBox().value;
}

/** Sets the editor contents and keeps the active workspace's draft in sync. */
function setSourceValue(value: string): void {
  sourceBox().value = value;
  if (workspaceSourcesReady) {
    workspaceSources[activeWorkspace] = value;
    saveWorkspaceSources();
  }
}

function sourceLooksLikeTikz(source: string): boolean {
  return /\\begin\{tikzpicture\}|\\tikz(?:set|picture)?\b|\\draw\b|\\node\b/.test(source);
}

/**
 * Asks for a name inline, under `anchor`. Office task panes block
 * window.prompt, so this is a tiny row with an input and two buttons.
 */
function askName(anchor: HTMLElement, placeholder: string, initial: string): Promise<string | null> {
  document.querySelector(".name-ask")?.remove();
  return new Promise((resolve) => {
    const row = document.createElement("div");
    row.className = "name-ask actions";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = initial;
    input.style.flex = "1";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "primary";
    ok.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.textContent = "Cancel";
    const done = (value: string | null) => {
      row.remove();
      resolve(value && value.trim() ? value.trim() : null);
    };
    ok.addEventListener("click", () => done(input.value));
    cancel.addEventListener("click", () => done(null));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") done(input.value);
      if (ev.key === "Escape") done(null);
    });
    row.append(input, ok, cancel);
    anchor.after(row);
    input.focus();
    input.select();
  });
}

// ── Boxes ────────────────────────────────────────────────────────

function boxFields(): BoxFields {
  return {
    label: el<HTMLInputElement>("box-type").value.replace(SAVED_MARK, "").trim() || "Theorem",
    number: el<HTMLInputElement>("box-number").value.trim(),
    auto: el<HTMLInputElement>("box-auto").checked,
    title: el<HTMLInputElement>("box-title").value.trim(),
    content: el<HTMLTextAreaElement>("box-content").value.trim(),
    style: (el<HTMLSelectElement>("box-style").value || "bar") as BoxStyle,
    accent: el<HTMLInputElement>("box-color").value,
    fill: boxFill,
    width: Number(el<HTMLInputElement>("box-width").value),
    unit: el<HTMLSelectElement>("box-width-unit").value || "%",
  };
}

/**
 * The box's width as a TeX dimension. Percent is a fraction of the
 * surrounding \linewidth and is not capped at 100, because standalone crops
 * to whatever the content actually measures.
 */
function boxWidthTex(f: Pick<BoxFields, "width" | "unit">): string {
  if (!Number.isFinite(f.width) || f.width <= 0) return "\\linewidth";
  if (f.unit === "%") {
    const fraction = clampNumber(f.width, MIN_BOX_PERCENT, MAX_BOX_PERCENT, 100) / 100;
    return Math.abs(fraction - 1) < 0.001 ? "\\linewidth" : `${trimNumber(fraction)}\\linewidth`;
  }
  return `${trimNumber(f.width)}${f.unit}`;
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

function buildBoxFrom(f: BoxFields): string {
  return buildBoxSource(f, boxWidthTex(f), paperHex());
}

function syncBoxSource(): void {
  const generated = buildBoxFrom(boxFields());
  lastGeneratedBoxSource = generated;
  boxSourceDirty = false;
  setSourceValue(generated);
}

function effectiveFill(): string {
  return "#" + boxColors(el<HTMLInputElement>("box-color").value, boxFill, paperHex()).fill;
}

function showBoxFill(): void {
  el<HTMLInputElement>("box-fill").value = effectiveFill().toLowerCase();
  el<HTMLButtonElement>("box-fill-auto").disabled = !boxFill;
}

function fillBoxTypeOptions(): void {
  const list = el<HTMLDataListElement>("box-type-options");
  list.innerHTML = "";
  for (const p of BUILTIN_PRESETS) {
    const o = document.createElement("option");
    o.value = p.label;
    list.append(o);
  }
  for (const p of loadBoxPresets()) {
    const o = document.createElement("option");
    o.value = SAVED_MARK + p.name;
    list.append(o);
  }
}

/** Next free number for this label. Re-editing a box keeps its own number. */
async function refreshAutoNumber(): Promise<void> {
  const auto = el<HTMLInputElement>("box-auto");
  if (!auto.checked || !shapeApi) return;
  const label = boxFields().label;
  const own = editing?.meta.box;
  let number: string;
  if (own && own.label === label && own.number) {
    number = own.number;
  } else {
    number = nextNumber(await boxNumbers(label, editing?.shapeId));
  }
  const field = el<HTMLInputElement>("box-number");
  if (field.value !== number) {
    field.value = number;
    if (activeWorkspace === "boxes" && !boxSourceDirty) syncBoxSource();
  }
}

let autoNumberTimer: number | undefined;
function scheduleAutoNumber(): void {
  window.clearTimeout(autoNumberTimer);
  autoNumberTimer = window.setTimeout(() => refreshAutoNumber().catch(() => undefined), 350);
}

function bindBoxBuilder(): void {
  const style = el<HTMLSelectElement>("box-style");
  for (const s of STYLES) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.label;
    style.append(o);
  }
  fillBoxTypeOptions();

  const autoBox = el<HTMLInputElement>("box-auto");
  autoBox.checked = settings.boxAutoNumber && shapeApi;
  autoBox.disabled = !shapeApi;
  autoBox.parentElement!.title = shapeApi
    ? "Number boxes with the same label in order across the presentation"
    : "Automatic numbering needs a current Microsoft 365 PowerPoint";
  el<HTMLInputElement>("box-number").disabled = autoBox.checked;

  const syncBox = () => {
    setWorkspace("boxes", { user: true, keepEditing: true });
    if (boxSourceDirty) {
      setStatus("Source was edited by hand, so it was left alone. Use Regenerate source to rebuild it.");
      return;
    }
    syncBoxSource();
  };

  // Picking a saved style from the list applies it; picking a built-in
  // label re-seeds that label's default accent. Typing just sets the label.
  const typeInput = el<HTMLInputElement>("box-type");
  typeInput.addEventListener("input", () => {
    const value = typeInput.value;
    if (value.startsWith(SAVED_MARK)) {
      const preset = loadBoxPresets().find((p) => SAVED_MARK + p.name === value);
      if (preset) {
        typeInput.value = preset.label;
        el<HTMLSelectElement>("box-style").value = preset.style;
        el<HTMLInputElement>("box-color").value = "#" + (preset.accent || "").replace("#", "").toLowerCase();
        boxFill = preset.fill || "";
        showBoxFill();
      }
    } else if (BUILTIN_PRESETS.some((p) => p.label === value)) {
      el<HTMLInputElement>("box-color").value = `#${defaultAccent(value).toLowerCase()}`;
      showBoxFill();
    }
    scheduleAutoNumber();
  });

  autoBox.addEventListener("change", () => {
    settings.boxAutoNumber = autoBox.checked;
    saveSettings(settings);
    el<HTMLInputElement>("box-number").disabled = autoBox.checked;
    refreshAutoNumber().catch(() => undefined);
  });

  el<HTMLInputElement>("box-color").addEventListener("input", showBoxFill);
  el<HTMLInputElement>("box-fill").addEventListener("input", () => {
    boxFill = el<HTMLInputElement>("box-fill").value;
    showBoxFill();
    syncBox();
  });
  el("box-fill-auto").addEventListener("click", () => {
    boxFill = "";
    showBoxFill();
    syncBox();
  });

  for (const id of ["box-type", "box-number", "box-title", "box-width", "box-width-unit", "box-color", "box-style", "box-content"]) {
    el(id).addEventListener("input", syncBox);
    el(id).addEventListener("change", syncBox);
  }
  el("btn-build-box").addEventListener("click", () => {
    // Explicit regenerate: the one action allowed to overwrite hand-edited source.
    setWorkspace("boxes", { user: true, keepEditing: true });
    syncBoxSource();
    sourceBox().focus();
    setStatus("Box source is ready to render.", "ok");
  });
  el("btn-save-box-style").addEventListener("click", async () => {
    const f = boxFields();
    const name = await askName(el("btn-save-box-style").parentElement!, "Style name", f.label);
    if (!name) return;
    saveBoxPreset({ name, label: f.label, style: f.style, accent: f.accent, fill: f.fill });
    fillBoxTypeOptions();
    setStatus(`Saved box style “${name}”. Pick it from Type.`, "ok");
  });
}

// ── Settings form ────────────────────────────────────────────────

function applySettingsToForm(): void {
  el<HTMLInputElement>("set-url").value = settings.serverUrl;
  el<HTMLInputElement>("set-token").value = settings.serverToken;
  el<HTMLTextAreaElement>("set-preamble").value = settings.extraPreamble;
  el<HTMLInputElement>("set-border").value = settings.border;
  el<HTMLSelectElement>("set-fontmode").value = settings.fontMode;
  el<HTMLInputElement>("set-font-name").value = settings.fontName;
  el<HTMLInputElement>("set-width").value = String(settings.insertWidthIn);
  el<HTMLInputElement>("set-scale").value = String(settings.rasterScale);
  el<HTMLInputElement>("set-transparent").checked = settings.transparentBackground;
  el<HTMLSelectElement>("engine").value = settings.engine;
  el<HTMLInputElement>("math-scale").value = String(settings.mathScale);
  el<HTMLInputElement>("math-spacing").value = String(settings.mathSpacing);
}

function readSettingsFromForm(): Settings {
  settings = {
    ...settings,
    serverUrl: el<HTMLInputElement>("set-url").value.trim(),
    serverToken: el<HTMLInputElement>("set-token").value.trim(),
    extraPreamble: el<HTMLTextAreaElement>("set-preamble").value,
    border: el<HTMLInputElement>("set-border").value.trim() || "2pt",
    fontMode: el<HTMLSelectElement>("set-fontmode").value as FontMode,
    fontName: el<HTMLInputElement>("set-font-name").value.trim(),
    insertWidthIn: Number(el<HTMLInputElement>("set-width").value) || 3,
    rasterScale: Number(el<HTMLInputElement>("set-scale").value) || 4,
    transparentBackground: el<HTMLInputElement>("set-transparent").checked,
    engine: el<HTMLSelectElement>("engine").value as TexEngine,
    mathScale: clampNumber(Number(el<HTMLInputElement>("math-scale").value), 50, 200, 100),
    mathSpacing: clampNumber(Number(el<HTMLInputElement>("math-spacing").value), -20, 40, 0),
  };
  saveSettings(settings);
  return settings;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// ── Render ───────────────────────────────────────────────────────

function styledSvg(raw: string, fromMathJax: boolean, widthIn = targetWidthInches()): string {
  return prepareSvgForOffice(raw, {
    // MathJax paints in currentColor; TeX output already carries the ink.
    color: fromMathJax ? inkHex() : undefined,
    scale: settings.mathScale / 100,
    spacing: settings.mathSpacing,
    widthPx: widthIn * CSS_PX_PER_INCH,
  });
}

function restylePreview(): void {
  if (!lastRawSvg) return;
  showPreview(styledSvg(lastRawSvg, lastRawWasMathJax));
  // The restyled image genuinely reflects the new settings, so refresh the
  // key too; otherwise the next insert would trigger a pointless recompile.
  lastRenderKey = renderKey(lastSource);
}

function showPreview(svg: string): void {
  const preview = el("preview");
  preview.innerHTML = svg;
  lastSvg = svg;
  for (const id of ["btn-insert", "btn-insert-svg", "btn-export"]) {
    el<HTMLButtonElement>(id).disabled = false;
  }
}

async function probeServer(): Promise<void> {
  const pill = el("server-pill");
  const health = await checkHealth(settings);
  const engines = health.engines.length ? health.engines.join(", ") : "no engines";
  const ready = health.ok && health.engines.length > 0 && !!health.svgTool;
  pill.textContent = ready ? "TeX" : "Off";
  pill.className = ready ? "pill ok" : "pill bad";
  pill.title = ready ? `${engines} · ${health.svgTool}` : "Start powerpoint/local-server";
}

interface Rendered {
  raw: string;
  fromMathJax: boolean;
  pdf: string | null;
  duration?: number;
}

/**
 * Renders `source` as the given workspace with the current Look. Shared by
 * the Render button and Re-render all. Math uses MathJax with the default
 * font (instant, no TeX needed) and real TeX for every other font.
 */
async function renderSource(source: string, workspace: Workspace, displayMath: boolean, engine: TexEngine): Promise<Rendered> {
  if (workspace === "math" && mathUsesMathJax()) {
    const raw = await renderMathToSvg(source, { display: displayMath, color: inkHex() });
    return { raw, fromMathJax: true, pdf: null };
  }
  const tex = workspace === "math" ? wrapMath(source, displayMath) : source;
  const looked = applyLook(tex, settings.extraPreamble, settings);
  const useEngine = engine === "pdflatex" && needsUnicodeEngine(settings.font, settings.fontName) ? "xelatex" : engine;
  const result = await renderFullLatex(settings, {
    source: looked.source,
    engine: useEngine,
    preamble: looked.preamble,
    border: settings.border,
    fontMode: settings.fontMode,
  });
  if (!result.success || !result.svg) {
    throw new Error((result.errors && result.errors.join("\n")) || "Compile failed.");
  }
  return { raw: result.svg, fromMathJax: false, pdf: result.pdf || null, duration: result.duration };
}

function currentMeta(source: string): ShapeMeta {
  const meta: ShapeMeta = {
    v: 1,
    source,
    workspace: activeWorkspace,
    engine: settings.engine,
    displayMath: el<HTMLInputElement>("display-math").checked,
  };
  if (activeWorkspace === "boxes") {
    meta.box = boxFields();
    meta.boxEdited = boxSourceDirty;
  }
  return meta;
}

async function renderNow(): Promise<string> {
  // In the packaged app the token is loaded from the same HTTPS origin on
  // boot. Await it here as well so the very first render cannot race it.
  await packagedTokenLoad;
  readSettingsFromForm();
  if (activeWorkspace === "boxes" && !boxSourceDirty) {
    await refreshAutoNumber().catch(() => undefined);
    syncBoxSource();
  }
  const source = currentSource().trim();
  if (!source) throw new Error("Type some LaTeX first.");

  if (mode === "quick" && looksLikeFullLatex(source)) {
    setStatus("This needs a TeX engine. Switching workspaces.", "ok");
    setWorkspace(sourceLooksLikeTikz(source) ? "tikz" : "latex", { user: true, keepEditing: true });
    // Carry the text across with it. Workspaces keep separate drafts, so
    // without this the switch would swap in the target workspace's old draft
    // and the source being rendered would vanish from the editor.
    setSourceValue(source);
  }

  const viaMathJax = activeWorkspace === "math" && mathUsesMathJax();
  setStatus(viaMathJax ? "Rendering..." : "Compiling with local TeX...");

  const r = await renderSource(source, activeWorkspace, el<HTMLInputElement>("display-math").checked, settings.engine);
  lastRawSvg = r.raw;
  lastRawWasMathJax = r.fromMathJax;
  lastPdf = r.pdf;
  lastSource = source;
  lastRenderKey = renderKey(source);
  lastMeta = currentMeta(source);
  const prepared = styledSvg(r.raw, r.fromMathJax);
  showPreview(prepared);
  setStatus(r.duration ? `Compiled in ${r.duration} ms` : "Rendered.", "ok");

  const entries = recordHistory(source, mode);
  const newest = entries[0];
  if (newest) {
    saveHistoryFile(settings, newest.id, prepared).catch(() => {
      /* best-effort; "open file location" just won't find anything for this one */
    });
  }
  if (activeTab === "recents") renderRecentsList();

  return prepared;
}

/**
 * Physical width the current render should end up at, in inches.
 *
 * The Boxes workspace has its own width control, and it has to drive the
 * real output size. Otherwise the LaTeX width only changes where the text
 * wraps and every box still lands on the slide at exactly settings.insertWidthIn,
 * which reads as "the width setting does nothing".
 *
 * Percent is taken against the default insert width; absolute units are
 * literal (10cm really is 10cm on the slide).
 */
function targetWidthInches(fields?: Pick<BoxFields, "width" | "unit">, workspace = activeWorkspace): number {
  if (workspace !== "boxes") return settings.insertWidthIn;
  const f = fields || boxFields();
  if (!Number.isFinite(f.width) || f.width <= 0) return settings.insertWidthIn;
  switch (f.unit) {
    case "mm":
      return f.width / 25.4;
    case "cm":
      return f.width / 2.54;
    case "in":
      return f.width;
    case "pt":
      return f.width / 72;
    default:
      return settings.insertWidthIn * (clampNumber(f.width, MIN_BOX_PERCENT, MAX_BOX_PERCENT, 100) / 100);
  }
}

async function pngFromSvg(svg: string, widthInches = targetWidthInches()): Promise<{ base64: string; widthPt: number; heightPt: number }> {
  const widthIn = widthInches * (settings.mathScale / 100);
  const size = computeRasterSize(svg, widthIn, settings.rasterScale);
  const png = await svgToPng(svg, size.widthPx, size.heightPx, {
    backgroundColor: settings.transparentBackground ? undefined : paperHex(),
  });
  return { base64: png.base64, widthPt: size.widthPt, heightPt: size.heightPt };
}

/**
 * Identity of a render: everything that can change the produced image.
 * Keyed on the inputs themselves, so a new setting can't silently let a
 * stale image through to the slide.
 */
function renderKey(source: string): string {
  return JSON.stringify([
    source,
    mode,
    activeWorkspace,
    resolveLook(settings),
    settings.font,
    settings.fontName,
    settings.mathScale,
    settings.mathSpacing,
    settings.engine,
    settings.border,
    settings.fontMode,
    settings.extraPreamble,
    targetWidthInches(),
    el<HTMLInputElement>("display-math").checked,
  ]);
}

async function ensureSvg(): Promise<string> {
  const source = currentSource().trim();
  if (lastSvg && lastRenderKey === renderKey(source)) return lastSvg;
  return renderNow();
}

// ── Insert, replace, re-render ───────────────────────────────────

function replacingEditedPicture(): boolean {
  return !!(shapeApi && editing && selectedTexer && selectedTexer.shapeId === editing.shapeId);
}

/** Inserts (or replaces the picture being edited) and tags the result. */
async function placeOnSlide(insert: () => Promise<{ widthPt: number; heightPt: number }>, what: string): Promise<void> {
  const meta = lastMeta || currentMeta(lastSource);
  if (replacingEditedPicture() && editing) {
    await replaceShape(editing, meta, insert);
    editing = await getSelectedTexer().catch(() => null);
    await refreshSelection();
    setStatus(`Replaced the picture you're editing (${what}).`, "ok");
    return;
  }
  const size = await insert();
  if (shapeApi) {
    await tagSelected({ ...meta, insertedWidth: size.widthPt }).catch(() => {
      /* not fatal: the picture is there, it just can't be re-edited */
    });
  }
  setStatus(`Inserted as ${what}.`, "ok");
}

async function insertPicture(): Promise<void> {
  if (!isInsideOffice()) {
    throw new Error("Open this task pane from PowerPoint to insert.");
  }
  const svg = await ensureSvg();
  const png = await pngFromSvg(svg);
  await placeOnSlide(async () => {
    await insertPngIntoSlide(png.base64, { widthPt: png.widthPt, heightPt: png.heightPt });
    return png;
  }, "a picture");
}

async function insertSvg(): Promise<void> {
  if (!isInsideOffice()) {
    throw new Error("Open this task pane from PowerPoint to insert.");
  }
  const svg = await ensureSvg();
  const size = computeRasterSize(svg, targetWidthInches() * (settings.mathScale / 100), settings.rasterScale);
  await placeOnSlide(async () => {
    await insertSvgIntoSlideExperimental(svg, { widthPt: size.widthPt, heightPt: size.heightPt });
    return size;
  }, "SVG");
}

function endEditing(): void {
  if (!editing) return;
  editing = null;
  updateEditButtons();
}

function updateEditButtons(): void {
  if (!shapeApi) return;
  const editingSelected = replacingEditedPicture();
  el<HTMLButtonElement>("btn-edit-selected").disabled = !selectedTexer || editingSelected;
  el("btn-insert").textContent = editingSelected ? "Replace picture" : "Insert picture";
  el("btn-insert-svg").textContent = editingSelected ? "Replace with SVG" : "Insert SVG";
}

async function refreshSelection(): Promise<void> {
  if (!shapeApi) return;
  selectedTexer = await getSelectedTexer().catch(() => null);
  updateEditButtons();
}

function loadMeta(meta: ShapeMeta): void {
  if (meta.engine) {
    settings.engine = meta.engine;
    el<HTMLSelectElement>("engine").value = meta.engine;
  }
  el<HTMLInputElement>("display-math").checked = meta.displayMath !== false;
  const box = meta.box;
  if (box) {
    el<HTMLInputElement>("box-type").value = box.label;
    el<HTMLInputElement>("box-number").value = box.number;
    el<HTMLInputElement>("box-auto").checked = !!box.auto && shapeApi;
    el<HTMLInputElement>("box-number").disabled = !!box.auto && shapeApi;
    el<HTMLInputElement>("box-title").value = box.title;
    el<HTMLTextAreaElement>("box-content").value = box.content;
    el<HTMLSelectElement>("box-style").value = box.style;
    el<HTMLInputElement>("box-color").value = "#" + (box.accent || "").replace("#", "").toLowerCase();
    el<HTMLInputElement>("box-width").value = String(box.width);
    el<HTMLSelectElement>("box-width-unit").value = box.unit;
    boxFill = box.fill || "";
    showBoxFill();
  }
  setWorkspace(meta.workspace, { user: true, keepEditing: true });
  setSourceValue(meta.source);
  if (meta.workspace === "boxes") {
    lastGeneratedBoxSource = meta.boxEdited ? "" : meta.source;
    boxSourceDirty = !!meta.boxEdited;
  }
}

async function editSelected(): Promise<void> {
  await refreshSelection();
  if (!selectedTexer) throw new Error("Select a Eneles picture on the slide first.");
  editing = selectedTexer;
  loadMeta(editing.meta);
  updateEditButtons();
  setStatus("Editing the selected picture. Change it, then Replace.", "ok");
}

/**
 * Re-renders every Eneles picture in the presentation with the current Look.
 * Each keeps its own source, workspace, engine and box fields; boxes that
 * were never hand-edited are rebuilt from their fields so the fill and
 * accent follow the new paper too.
 */
async function rerenderAll(): Promise<void> {
  await packagedTokenLoad;
  readSettingsFromForm();
  const shapes = await listTexerShapes();
  if (!shapes.length) {
    setStatus("There are no Eneles pictures in this presentation yet.");
    return;
  }
  const failures: string[] = [];
  let done = 0;
  for (const shape of shapes) {
    const meta = { ...shape.meta };
    try {
      if (meta.workspace === "boxes" && meta.box && !meta.boxEdited) meta.source = buildBoxFrom(meta.box);
      const r = await renderSource(meta.source, meta.workspace, meta.displayMath !== false, meta.engine || settings.engine);
      const widthIn = targetWidthInches(meta.box, meta.workspace);
      const svg = styledSvg(r.raw, r.fromMathJax, widthIn);
      const png = await pngFromSvg(svg, widthIn);
      await replaceShape(shape, meta, async () => {
        await insertPngIntoSlide(png.base64, { widthPt: png.widthPt, heightPt: png.heightPt });
        return png;
      });
      done++;
      setStatus(`Re-rendered ${done} of ${shapes.length}...`);
    } catch (err) {
      failures.push(`${meta.source.replace(/\s+/g, " ").slice(0, 30)}: ${formatError(err)}`);
    }
  }
  editing = null;
  await refreshSelection();
  if (failures.length) {
    setStatus(`Re-rendered ${done} of ${shapes.length}. Failed:\n${failures.slice(0, 3).join("\n")}`, "err");
  } else {
    setStatus(`Re-rendered all ${done} pictures with the current Look.`, "ok");
  }
}

// ── Export ───────────────────────────────────────────────────────

function download(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

async function exportAs(kind: string): Promise<void> {
  if (kind === "copy-source") {
    await copyText(currentSource());
    setStatus("LaTeX source copied to the clipboard.", "ok");
    return;
  }
  if (!lastSvg) throw new Error("Render something first.");
  if (kind === "svg") {
    const url = svgToDownloadUrl(lastSvg);
    download(url, "texer.svg");
    URL.revokeObjectURL(url);
  } else if (kind === "pdf") {
    if (!lastPdf) {
      throw new Error(
        lastRawWasMathJax
          ? "PDF needs a TeX render. Pick another font, or use the LaTeX workspace."
          : "This server didn't return a PDF. Update Eneles.",
      );
    }
    download(`data:application/pdf;base64,${lastPdf}`, "texer.pdf");
  } else if (kind === "png") {
    const png = await pngFromSvg(lastSvg);
    download(`data:image/png;base64,${png.base64}`, "texer.png");
  } else if (kind === "copy-svg") {
    await copyText(lastSvg);
    setStatus("SVG copied to the clipboard.", "ok");
    return;
  }
  setStatus(`Saved texer.${kind}.`, "ok");
}

function bindExportMenu(): void {
  const button = el<HTMLButtonElement>("btn-export");
  const menu = el("export-menu");
  const close = () => {
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const opening = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !opening);
    button.setAttribute("aria-expanded", String(opening));
    const pdfItem = menu.querySelector<HTMLButtonElement>('[data-export="pdf"]');
    if (pdfItem) pdfItem.disabled = !lastPdf;
  });
  menu.querySelectorAll<HTMLButtonElement>("[data-export]").forEach((item) => {
    item.addEventListener("click", () => {
      close();
      exportAs(item.dataset.export || "").catch((err) => setStatus(formatError(err), "err"));
    });
  });
  document.addEventListener("click", (ev) => {
    if (!menu.contains(ev.target as Node)) close();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });
}

/**
 * Copies text, with a fallback for the task pane.
 *
 * navigator.clipboard.writeText rejects with "Document is not focused" when
 * PowerPoint has focus on the slide rather than the pane, which is exactly
 * the situation you're in when reaching for a Copy button. Fall back to a
 * throwaway textarea plus execCommand, which has no focus requirement.
 */
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through to the legacy path */
  }

  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  scratch.style.position = "fixed";
  scratch.style.top = "-1000px";
  scratch.style.opacity = "0";
  document.body.appendChild(scratch);
  scratch.select();
  scratch.setSelectionRange(0, scratch.value.length);
  const ok = document.execCommand("copy");
  document.body.removeChild(scratch);
  if (!ok) throw new Error("Could not copy. Select the text and copy it manually.");
}

// ── Recents and Saved tabs ───────────────────────────────────────

function truncatedLabel(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function renderRecentsList(): void {
  const list = el("recents-list");
  const empty = el("recents-empty");
  const entries = loadHistory();

  list.innerHTML = "";
  empty.classList.toggle("hidden", entries.length > 0);

  for (const entry of entries) {
    list.append(buildRecentItem(entry));
  }
}

function openInEditor(workspace: Workspace, source: string): void {
  // Switch first: setWorkspace swaps in that workspace's stored draft,
  // so writing the source before it would just get overwritten.
  setWorkspace(workspace, { user: true });
  setSourceValue(source);
  sourceBox().focus();
}

function buildRow(label: string, title: string, onOpen: (() => void) | null, actions: HTMLButtonElement[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "recent-item";
  const text = document.createElement("button");
  text.type = "button";
  text.className = "recent-text";
  text.textContent = label;
  text.title = title;
  if (onOpen) text.addEventListener("click", onOpen);
  else text.disabled = true;
  const box = document.createElement("div");
  box.className = "recent-actions";
  box.append(...actions);
  row.append(text, box);
  return row;
}

function buildRecentItem(entry: HistoryEntry): HTMLElement {
  const workspace: Workspace = entry.mode === "quick" ? "math" : sourceLooksLikeTikz(entry.source) ? "tikz" : "latex";
  const copyBtn = makeIconButton(ICON_COPY, "Copy source", async () => {
    await copyText(entry.source);
    setStatus("Source copied to the clipboard.", "ok");
  });
  const openBtn = makeIconButton(ICON_FOLDER, "Open file location", async () => {
    const result = await openHistoryFile(settings, entry.id);
    if (!result.success) throw new Error((result.errors && result.errors[0]) || "Could not open file location.");
    setStatus("Opened the render in Explorer.", "ok");
  });
  const trashBtn = makeIconButton(ICON_TRASH, "Delete", async () => {
    removeHistoryEntry(entry.id);
    renderRecentsList();
    deleteHistoryFile(settings, entry.id).catch(() => {
      /* best-effort */
    });
  });
  trashBtn.classList.add("danger");
  return buildRow(truncatedLabel(entry.source), entry.source, () => openInEditor(workspace, entry.source), [
    copyBtn,
    openBtn,
    trashBtn,
  ]);
}

function renderSavedLists(): void {
  const snippets = loadSnippets();
  const list = el("saved-list");
  list.innerHTML = "";
  el("saved-empty").classList.toggle("hidden", snippets.length > 0);
  for (const s of snippets) {
    const trash = makeIconButton(ICON_TRASH, "Delete", () => {
      removeSnippet(s.id);
      renderSavedLists();
      renderSnippetOptions();
    });
    trash.classList.add("danger");
    list.append(buildRow(`[${s.workspace}] ${s.label}`, s.source, () => openInEditor(s.workspace, s.source), [trash]));
  }

  const presets = loadBoxPresets();
  const plist = el("box-presets-list");
  plist.innerHTML = "";
  el("box-presets-empty").classList.toggle("hidden", presets.length > 0);
  for (const p of presets) {
    const trash = makeIconButton(ICON_TRASH, "Delete", () => {
      removeBoxPreset(p.name);
      fillBoxTypeOptions();
      renderSavedLists();
    });
    trash.classList.add("danger");
    plist.append(buildRow(`${p.name} (${p.label}, ${p.style})`, p.name, null, [trash]));
  }
}

function makeIconButton(iconSvg: string, title: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = title;
  btn.innerHTML = iconSvg;
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    Promise.resolve(onClick()).catch((err) => setStatus(formatError(err), "err"));
  });
  return btn;
}

// ── Wiring ───────────────────────────────────────────────────────

function bindUi(): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as TabName | undefined;
      if (tab) setActiveTab(tab);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      const workspace = btn.dataset.workspace as Workspace | undefined;
      if (workspace) setWorkspace(workspace, { user: true });
    });
  });
  el("theme-toggle").addEventListener("click", toggleTheme);
  el("preview-bg").addEventListener("click", cyclePreviewBackground);

  const select = el<HTMLSelectElement>("snippet-select");
  renderSnippetOptions();
  select.addEventListener("change", () => {
    const [kind, id] = select.value.split(":");
    select.value = "";
    const found =
      kind === "builtin"
        ? SNIPPETS.find((s) => s.id === id)
        : kind === "saved"
          ? loadSnippets().find((s) => s.id === id)
          : undefined;
    if (!found) return;
    setWorkspace(found.workspace, { user: true });
    setSourceValue(found.source);
  });
  el("btn-save-snippet").addEventListener("click", async () => {
    const source = currentSource().trim();
    if (!source) throw new Error("Nothing to save yet.");
    const name = await askName(el("source-field"), "Snippet name", truncatedLabel(source).slice(0, 40));
    if (!name) return;
    saveSnippet(name, activeWorkspace, source);
    renderSnippetOptions();
    if (activeTab === "saved") renderSavedLists();
    setStatus(`Saved “${name}”. It's under Examples and in the Saved tab.`, "ok");
  });

  const chips = el("tikz-library-chips");
  for (const chip of TIKZ_LIBRARY_CHIPS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = chip.label;
    btn.addEventListener("click", () => {
      setWorkspace("tikz", { user: true, keepEditing: true });
      setSourceValue(insertLine(currentSource(), chip.line));
      sourceBox().focus();
    });
    chips.append(btn);
  }

  const tikzStarter = el<HTMLSelectElement>("tikz-starter");
  for (const template of TIKZ_TEMPLATES) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    tikzStarter.append(option);
  }
  tikzStarter.addEventListener("change", () => {
    const template = TIKZ_TEMPLATES.find((item) => item.id === tikzStarter.value);
    tikzStarter.value = "";
    if (!template) return;
    setWorkspace("tikz", { user: true });
    setSourceValue(template.source);
    sourceBox().focus();
  });

  bindLook();
  bindBoxBuilder();
  bindExportMenu();

  el("btn-render").addEventListener("click", () => {
    renderNow().catch((err) => setStatus(formatError(err), "err"));
  });
  el("btn-insert").addEventListener("click", () => {
    insertPicture().catch((err) => setStatus(formatError(err), "err"));
  });
  el("btn-insert-svg").addEventListener("click", () => {
    insertSvg().catch((err) => setStatus(formatError(err), "err"));
  });
  el("btn-edit-selected").addEventListener("click", () => {
    editSelected().catch((err) => setStatus(formatError(err), "err"));
  });
  el("btn-rerender").addEventListener("click", () => {
    const btn = el<HTMLButtonElement>("btn-rerender");
    btn.disabled = true;
    rerenderAll()
      .catch((err) => setStatus(formatError(err), "err"))
      .finally(() => (btn.disabled = false));
  });
  el("btn-check").addEventListener("click", () => {
    readSettingsFromForm();
    probeServer()
      .then(() => setStatus("Reached the local server.", "ok"))
      .catch((err) => setStatus(formatError(err), "err"));
  });
  el("server-pill").addEventListener("click", () => {
    setActiveTab("settings");
    probeServer().catch((err) => setStatus(formatError(err), "err"));
  });

  for (const id of [
    "set-url",
    "set-token",
    "set-preamble",
    "set-border",
    "set-fontmode",
    "set-font-name",
    "set-width",
    "set-scale",
    "set-transparent",
    "engine",
    "math-scale",
    "math-spacing",
  ]) {
    el(id).addEventListener("change", () => {
      readSettingsFromForm();
      if (id === "math-scale" || id === "math-spacing" || id === "set-width") restylePreview();
      if (id === "set-font-name" && settings.font === "system") onLookChanged();
    });
  }

  el("display-math").addEventListener("change", () => {
    if (lastSource) renderNow().catch((err) => setStatus(formatError(err), "err"));
  });

  sourceBox().addEventListener("input", () => {
    if (workspaceSourcesReady) {
      workspaceSources[activeWorkspace] = sourceBox().value;
      saveWorkspaceSources();
    }
    if (activeWorkspace === "boxes" && sourceBox().value !== lastGeneratedBoxSource) {
      boxSourceDirty = true;
    }
  });

  sourceBox().addEventListener("keydown", (ev: KeyboardEvent) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      ev.preventDefault();
      if (ev.shiftKey) insertPicture().catch((err) => setStatus(formatError(err), "err"));
      else renderNow().catch((err) => setStatus(formatError(err), "err"));
    }
  });
}

function formatError(err: unknown): string {
  if (err instanceof LocalServerError || err instanceof QuickMathError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function boot(): void {
  shapeApi = isInsideOffice() && shapeApiSupported();
  applyTheme(settings.theme);
  applySettingsToForm();
  loadWorkspaceSources();
  bindUi();
  applyLookToForm();
  el<HTMLInputElement>("box-color").value = `#${defaultAccent("Theorem").toLowerCase()}`;
  showBoxFill();
  setWorkspace(activeWorkspace, { user: false });
  // Seed the textarea with the restored draft for whichever workspace we
  // opened in, then let switches start swapping drafts from here on.
  sourceBox().value = workspaceSources[activeWorkspace] || "";
  workspaceSourcesReady = true;
  setActiveTab("recents");

  if (shapeApi) {
    el("btn-edit-selected").classList.remove("hidden");
    el("btn-rerender").classList.remove("hidden");
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, () => {
      refreshSelection().catch(() => undefined);
    });
    refreshSelection().catch(() => undefined);
  }

  packagedTokenLoad = loadPackagedServerToken().then((token) => {
    if (!token) return;
    settings = { ...settings, serverToken: token };
    saveSettings(settings);
    el<HTMLInputElement>("set-token").value = token;
  });
  probeServer().catch(() => {
    el("server-pill").textContent = "Off";
    el("server-pill").className = "pill bad";
  });
  if (!isInsideOffice()) {
    setStatus("Preview only. Insert needs PowerPoint.");
  }
}

let booted = false;
function bootOnce(): void {
  if (booted) return;
  booted = true;
  boot();
}

if (typeof Office !== "undefined") {
  Office.onReady(() => bootOnce());
} else {
  window.addEventListener("DOMContentLoaded", bootOnce);
}
