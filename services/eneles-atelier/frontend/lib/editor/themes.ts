import type { Extension } from "@codemirror/state";

export interface EditorThemeOption {
  id: string;
  label: string;
  /** "both": the theme follows the site's mode (Thry, which is written against the design tokens). */
  type: "dark" | "light" | "both";
}

/**
 * All available editor themes, grouped by dark/light.
 * The actual CodeMirror extensions are lazy-loaded to avoid bundling everything upfront.
 */
export const EDITOR_THEMES: EditorThemeOption[] = [
  // ── Ours: the interface's own colors, in whichever mode the site is in. The default. ──
  { id: "thry", label: "Thry", type: "both" },

  // ── Dark themes ──
  { id: "vscode-dark", label: "VS Code Dark", type: "dark" },
  { id: "github-dark", label: "GitHub Dark", type: "dark" },
  { id: "dracula", label: "Dracula", type: "dark" },
  { id: "monokai", label: "Monokai", type: "dark" },
  { id: "monokai-dimmed", label: "Monokai Dimmed", type: "dark" },
  { id: "tokyo-night", label: "Tokyo Night", type: "dark" },
  { id: "tokyo-night-storm", label: "Tokyo Night Storm", type: "dark" },
  { id: "nord", label: "Nord", type: "dark" },
  { id: "sublime", label: "Sublime", type: "dark" },
  { id: "material-dark", label: "Material Dark", type: "dark" },
  { id: "aura", label: "Aura", type: "dark" },
  { id: "copilot", label: "Copilot", type: "dark" },
  { id: "andromeda", label: "Andromeda", type: "dark" },
  { id: "atomone", label: "Atom One Dark", type: "dark" },
  { id: "abyss", label: "Abyss", type: "dark" },
  { id: "darcula", label: "Darcula (JetBrains)", type: "dark" },
  { id: "solarized-dark", label: "Solarized Dark", type: "dark" },
  { id: "gruvbox-dark", label: "Gruvbox Dark", type: "dark" },
  { id: "okaidia", label: "Okaidia", type: "dark" },
  { id: "bespin", label: "Bespin", type: "dark" },
  { id: "kimbie", label: "Kimbie", type: "dark" },
  { id: "tomorrow-night-blue", label: "Tomorrow Night Blue", type: "dark" },
  { id: "red", label: "Red", type: "dark" },
  { id: "android-studio", label: "Android Studio", type: "dark" },

  // ── Light themes ──
  { id: "vscode-light", label: "VS Code Light", type: "light" },
  { id: "github-light", label: "GitHub Light", type: "light" },
  { id: "eclipse", label: "Eclipse", type: "light" },
  { id: "xcode-light", label: "Xcode Light", type: "light" },
  { id: "material-light", label: "Material Light", type: "light" },
  { id: "solarized-light", label: "Solarized Light", type: "light" },
  { id: "quietlight", label: "Quiet Light", type: "light" },
  { id: "noctis-lilac", label: "Noctis Lilac", type: "light" },
  { id: "bbedit", label: "BBEdit", type: "light" },
  { id: "duotone-light", label: "Duotone Light", type: "light" },
  { id: "tokyo-night-day", label: "Tokyo Night Day", type: "light" },
  { id: "basic-light", label: "Basic Light", type: "light" },
  { id: "white-light", label: "White", type: "light" },
];

/** Default themes per mode */
export const DEFAULT_DARK_THEME = "thry";
export const DEFAULT_LIGHT_THEME = "thry";

/**
 * Lazily load a CodeMirror theme extension by ID.
 * Each theme is imported on demand so we don't bundle all 30+ themes.
 */
export async function loadThemeExtension(id: string): Promise<Extension> {
  switch (id) {
    case "thry": {
      const m = await import("./thry-theme");
      return m.thry;
    }
    // ── Dark ──
    case "vscode-dark": {
      const m = await import("@uiw/codemirror-theme-vscode");
      return m.vscodeDark;
    }
    case "github-dark": {
      const m = await import("@uiw/codemirror-theme-github");
      return m.githubDark;
    }
    case "dracula": {
      const m = await import("@uiw/codemirror-theme-dracula");
      return m.dracula;
    }
    case "monokai": {
      const m = await import("@uiw/codemirror-theme-monokai");
      return m.monokai;
    }
    case "monokai-dimmed": {
      const m = await import("@uiw/codemirror-theme-monokai-dimmed");
      return m.monokaiDimmed;
    }
    case "tokyo-night": {
      const m = await import("@uiw/codemirror-theme-tokyo-night");
      return m.tokyoNight;
    }
    case "tokyo-night-storm": {
      const m = await import("@uiw/codemirror-theme-tokyo-night-storm");
      return m.tokyoNightStorm;
    }
    case "nord": {
      const m = await import("@uiw/codemirror-theme-nord");
      return m.nord;
    }
    case "sublime": {
      const m = await import("@uiw/codemirror-theme-sublime");
      return m.sublime;
    }
    case "material-dark": {
      const m = await import("@uiw/codemirror-theme-material");
      return m.materialDark;
    }
    case "aura": {
      const m = await import("@uiw/codemirror-theme-aura");
      return m.aura;
    }
    case "copilot": {
      const m = await import("@uiw/codemirror-theme-copilot");
      return m.copilot;
    }
    case "andromeda": {
      const m = await import("@uiw/codemirror-theme-andromeda");
      return m.andromeda;
    }
    case "atomone": {
      const m = await import("@uiw/codemirror-theme-atomone");
      return m.atomone;
    }
    case "abyss": {
      const m = await import("@uiw/codemirror-theme-abyss");
      return m.abyss;
    }
    case "darcula": {
      const m = await import("@uiw/codemirror-theme-darcula");
      return m.darcula;
    }
    case "solarized-dark": {
      const m = await import("@uiw/codemirror-theme-solarized");
      return m.solarizedDark;
    }
    case "gruvbox-dark": {
      const m = await import("@uiw/codemirror-theme-gruvbox-dark");
      return m.gruvboxDark;
    }
    case "okaidia": {
      const m = await import("@uiw/codemirror-theme-okaidia");
      return m.okaidia;
    }
    case "bespin": {
      const m = await import("@uiw/codemirror-theme-bespin");
      return m.bespin;
    }
    case "kimbie": {
      const m = await import("@uiw/codemirror-theme-kimbie");
      return m.kimbie;
    }
    case "tomorrow-night-blue": {
      const m = await import("@uiw/codemirror-theme-tomorrow-night-blue");
      return m.tomorrowNightBlue;
    }
    case "red": {
      const m = await import("@uiw/codemirror-theme-red");
      return m.red;
    }
    case "android-studio": {
      const m = await import("@uiw/codemirror-theme-androidstudio");
      return m.androidstudio;
    }

    // ── Light ──
    case "vscode-light": {
      const m = await import("@uiw/codemirror-theme-vscode");
      return m.vscodeLight;
    }
    case "github-light": {
      const m = await import("@uiw/codemirror-theme-github");
      return m.githubLight;
    }
    case "eclipse": {
      const m = await import("@uiw/codemirror-theme-eclipse");
      return m.eclipse;
    }
    case "xcode-light": {
      const m = await import("@uiw/codemirror-theme-xcode");
      return m.xcodeLight;
    }
    case "material-light": {
      const m = await import("@uiw/codemirror-theme-material");
      return m.materialLight;
    }
    case "solarized-light": {
      const m = await import("@uiw/codemirror-theme-solarized");
      return m.solarizedLight;
    }
    case "quietlight": {
      const m = await import("@uiw/codemirror-theme-quietlight");
      return m.quietlight;
    }
    case "noctis-lilac": {
      const m = await import("@uiw/codemirror-theme-noctis-lilac");
      return m.noctisLilac;
    }
    case "bbedit": {
      const m = await import("@uiw/codemirror-theme-bbedit");
      return m.bbedit;
    }
    case "duotone-light": {
      const m = await import("@uiw/codemirror-theme-duotone");
      return m.duotoneLight;
    }
    case "tokyo-night-day": {
      const m = await import("@uiw/codemirror-theme-tokyo-night-day");
      return m.tokyoNightDay;
    }
    case "basic-light": {
      const m = await import("@uiw/codemirror-theme-basic");
      return m.basicLight;
    }
    case "white-light": {
      const m = await import("@uiw/codemirror-theme-white");
      return m.whiteLight;
    }

    default:
      // Fallback: no theme (uses CodeMirror default)
      return [];
  }
}

/**
 * Resolve the best theme ID for the current site theme.
 * If the user picked a specific editor theme, use it.
 * Otherwise, pick the default for the resolved site theme.
 */
export function resolveEditorTheme(
  selectedThemeId: string | null,
  siteTheme: "dark" | "light"
): string {
  if (selectedThemeId) {
    return selectedThemeId;
  }
  return siteTheme === "dark" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
}

/** Local-storage key for persisting the user's editor theme choice */
export const EDITOR_THEME_STORAGE_KEY = "texer-editor-theme";

/** Whether an id is one of the editor's themes (a stored choice may name a theme that has since been removed). */
export const isEditorTheme = (id: string | null | undefined): id is string => !!id && EDITOR_THEMES.some((theme) => theme.id === id);
