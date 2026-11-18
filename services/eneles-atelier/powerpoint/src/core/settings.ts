import { DEFAULT_SETTINGS, FontId, PreviewBackground, Settings, SlidePreset } from "./types";

const STORAGE_KEY = "texer-ppt.settings.v1";
const PREVIEW_BACKGROUNDS: PreviewBackground[] = ["slide", "checker", "white", "black"];
const SLIDE_PRESETS: SlidePreset[] = ["light", "dark", "custom"];
const FONT_IDS: FontId[] = ["cm", "lm", "palatino", "times", "libertine", "sans", "system"];

// Server URLs that shipped as defaults in earlier builds. The saved value in
// localStorage would otherwise keep pointing at a port nothing listens on
// any more, and the add-in would come up dead after an update with no
// indication why. Anyone who set a custom URL keeps it.
const LEGACY_SERVER_URLS = ["http://127.0.0.1:4756", "http://localhost:4756"];

// Inks the old Math-only colour picker started from (and that the pane
// theme toggle flipped between). Anything else was a deliberate choice and
// becomes a Custom look on upgrade.
const DEFAULT_MATH_INKS = ["#171717", "#1A1A1A", "#F5F5F5"];

function systemTheme(): Settings["theme"] {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function migrateServerUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_SETTINGS.serverUrl;
  const normalised = value.trim().replace(/\/+$/, "");
  return LEGACY_SERVER_URLS.includes(normalised) ? DEFAULT_SETTINGS.serverUrl : value;
}

// Spread-merging a stored blob only fills in *absent* keys, so a stale or
// corrupt value for an enum field would survive and end up driving CSS class
// names that don't exist. Validate the enums explicitly.
function oneOf<T>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, theme: systemTheme() };
    const parsed = JSON.parse(raw);
    const theme = parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : systemTheme();
    const out: Settings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      theme,
      serverUrl: migrateServerUrl(parsed.serverUrl),
      previewBackground: oneOf(parsed.previewBackground, PREVIEW_BACKGROUNDS, DEFAULT_SETTINGS.previewBackground),
      slidePreset: oneOf(parsed.slidePreset, SLIDE_PRESETS, DEFAULT_SETTINGS.slidePreset),
      font: oneOf(parsed.font, FONT_IDS, DEFAULT_SETTINGS.font),
    };
    const oldInk = typeof parsed.mathColor === "string" ? parsed.mathColor.toUpperCase() : "";
    if (!("slidePreset" in parsed) && oldInk && !DEFAULT_MATH_INKS.includes(oldInk)) {
      Object.assign(out, { slidePreset: "custom", ink: parsed.mathColor, paper: "#FFFFFF" });
    }
    // Fields that no longer exist: the Look replaced them.
    delete (out as unknown as Record<string, unknown>).mathColor;
    delete (out as unknown as Record<string, unknown>).boxTextColor;
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS, theme: systemTheme() };
  }
}

export function saveSettings(settings: Settings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  saveSettings(next);
  return next;
}
