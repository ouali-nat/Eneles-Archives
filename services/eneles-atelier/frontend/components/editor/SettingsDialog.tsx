"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { LongScroll } from "@/components/essential/layout/LongScroll";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, Settings2, Palette, Loader2, Braces, Search, Plus, RotateCcw, Pencil, Check, X, Trash2, Sparkles, Zap, ChevronDown, ChevronRight, Code } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import {
  editorSettingsAPI,
  projectsAPI,
  type EditorSettings,
  type ProjectSettings,
  type UserMacro,
} from "@/lib/api";
import { LATEX_SNIPPETS } from "@/lib/latex/snippets";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AssistantCommandsSettings } from "@/components/editor/settings/AssistantCommands";
import { AiProviderSettings } from "@/components/editor/settings/AiProviderSettings";
import { AxyaIcon } from "@/components/editor/assistant/Conversation";
import { Segmented } from "@/components/ui/segmented";
import { EDITOR_THEMES } from "@/lib/editor/themes";

interface SettingsDialogProps {
  /** Called when the user changes tab size; reindents all project files from oldSize to newSize */
  onReindentProject?: (oldSize: number, newSize: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectUid: string;
  projectFiles?: { id: string; path: string }[];
  onEditorSettingsChange?: (settings: EditorSettings) => void;
  onProjectSettingsChange?: (settings: ProjectSettings) => void;
  onOpenDictionary?: () => void;
  /** The tab shown when the dialog opens (the assistant's card opens it at Axya). */
  initialTab?: SettingsTab;
  /** Where the settings are kept, when not in the account and the project through the API: the desktop app keeps a folder's settings on the computer. */
  store?: SettingsStore | null;
}

export type SettingsTab = "editor" | "compiler" | "appearance" | "macros" | "snippets" | "assistant";

/** Settings kept somewhere other than the API. With a store the dialog reads and writes only through it, signed in or not. */
export interface SettingsStore {
  load: () => Promise<{ editor?: Partial<EditorSettings> | null; project?: Partial<ProjectSettings> | null; macros?: UserMacro[] | null }>;
  /** The whole change, client-side fields (autoIndent) included. */
  saveEditor: (patch: Partial<EditorSettings>) => void;
  saveProject: (patch: Partial<ProjectSettings>) => void;
  /** The tabs offered, in their usual order; every tab when left out. */
  tabs?: SettingsTab[];
}

const TAB_CONFIG: {
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    id: "editor",
    label: "Editor",
    icon: BookOpen,
    description: "Code editing behavior",
  },
  {
    id: "compiler",
    label: "Compiler",
    icon: Settings2,
    description: "Build settings",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Look & feel",
  },
  {
    id: "macros",
    label: "Macros",
    icon: Braces,
    description: "LaTeX shortcuts",
  },
  {
    id: "snippets",
    label: "Snippets",
    icon: Zap,
    description: "Shift+Space palette",
  },
  {
    id: "assistant",
    label: "Axya",
    icon: AxyaIcon,
    description: "Keys, models, and slash commands",
  },
];

export function SettingsDialog({
  open,
  onOpenChange,
  projectUid,
  projectFiles = [],
  onEditorSettingsChange,
  onProjectSettingsChange,
  onOpenDictionary,
  onReindentProject,
  initialTab = "editor",
  store = null,
}: SettingsDialogProps) {
  const { isAuthenticated } = useAuth();
  // With a store of its own the dialog does not need the account.
  const canLoad = !!store || isAuthenticated;
  const tabs = store?.tabs ? TAB_CONFIG.filter((t) => store.tabs!.includes(t.id)) : TAB_CONFIG;
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  // Opening again (from the assistant's card, say) shows the tab asked for.
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) setActiveTab(initialTab);
  }

  // Editor settings state: autoIndent is client-side only, stored in localStorage
  const [editorSettings, setEditorSettings] = useState<EditorSettings>({
    autoComplete: true,
    autoCloseBrackets: true,
    autoIndent:
      typeof window !== "undefined"
        ? localStorage.getItem("texer:autoIndent") !== "false"
        : true,
    codeCheck: true,
    spellcheckLang: "en",
    theme: "dark",
    editorTheme: "thry",
    pdfTheme: "light",
    fontSize: 16,
    fontFamily: "Consolas",
    lineHeight: "normal",
  });

  // Project settings state
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>({
    mainDocument: "main.tex",
    compiler: "pdflatex",
    texLiveVersion: "2024",
    compileMode: "normal",
    stopOnFirstError: false,
    autoCompile: false,
    tabSize: 4,
    macrosEnabled: true,
    snippetsEnabled: true,
  });

  // Macros state
  const [macros, setMacros] = useState<UserMacro[]>([]);
  const [macroSearch, setMacroSearch] = useState("");
  const [editingMacro, setEditingMacro] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editExpansion, setEditExpansion] = useState("");
  const [addingMacro, setAddingMacro] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExpansion, setNewExpansion] = useState("");
  const [macroSaving, setMacroSaving] = useState(false);

  // Show the loader again whenever a new load starts (the dialog opens, a sign-in arrives, or the project changes while it is open).
  const loadKey = open && canLoad ? projectUid : null;
  const [prevLoadKey, setPrevLoadKey] = useState<string | null>(null);
  if (prevLoadKey !== loadKey) {
    setPrevLoadKey(loadKey);
    if (loadKey !== null) setLoading(true);
  }

  // Load settings on open
  useEffect(() => {
    if (!open || !canLoad) return;

    const loaded: Promise<[Partial<EditorSettings> | null | undefined, Partial<ProjectSettings> | null | undefined, UserMacro[] | null | undefined]> = store
      ? store
          .load()
          .catch(() => ({ editor: null, project: null, macros: null }))
          .then((s) => [s.editor, s.project, s.macros])
      : Promise.all([
          editorSettingsAPI.getEditorSettings().catch(() => null),
          projectsAPI.getProjectSettings(projectUid).catch(() => null),
          editorSettingsAPI.getMacros().catch(() => [] as UserMacro[]),
        ]);
    loaded.then(([editor, project, macrosData]) => {
      if (editor) {
        const savedAutoIndent = localStorage.getItem("texer:autoIndent");
        setEditorSettings((prev) => ({
          ...prev,
          ...editor,
          // A store keeps autoIndent itself; the API does not, so this browser does.
          autoIndent:
            store && editor.autoIndent !== undefined
              ? editor.autoIndent
              : savedAutoIndent !== null
                ? savedAutoIndent === "true"
                : prev.autoIndent,
        }));
      }
      if (project) setProjectSettings((prev) => ({ ...prev, ...project }));
      if (macrosData) setMacros(macrosData);
      setLoading(false);
    });
    // The store is read when the dialog opens; a new store object on each render must not load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canLoad, projectUid]);

  // Persist editor setting change
  const updateEditor = useCallback(
    (patch: Partial<EditorSettings>) => {
      const updated = { ...editorSettings, ...patch };
      setEditorSettings(updated);
      onEditorSettingsChange?.(updated);
      // Persist client-side-only fields to localStorage
      if ("autoIndent" in patch) {
        localStorage.setItem("texer:autoIndent", String(patch.autoIndent));
      }
      if (store) store.saveEditor(patch);
      else if (isAuthenticated) {
        // Strip client-side-only fields that don't exist in the backend schema
        const { autoIndent: _autoIndent, ...serverPatch } =
          patch as Partial<EditorSettings> & { autoIndent?: boolean };
        if (Object.keys(serverPatch).length > 0) {
          editorSettingsAPI
            .updateEditorSettings(serverPatch)
            .catch(console.error);
        }
      }
    },
    [editorSettings, isAuthenticated, onEditorSettingsChange, store],
  );

  // Persist project setting change
  const updateProject = useCallback(
    (patch: Partial<ProjectSettings>) => {
      const updated = { ...projectSettings, ...patch };
      setProjectSettings(updated);
      onProjectSettingsChange?.(updated);
      if (store) store.saveProject(patch);
      else if (isAuthenticated) {
        projectsAPI
          .updateProjectSettings(projectUid, patch)
          .catch(console.error);
      }
    },
    [projectSettings, isAuthenticated, projectUid, onProjectSettingsChange, store],
  );

  // Macro operations
  const handleSaveMacro = useCallback(
    async (name: string, expansion: string) => {
      if (!isAuthenticated) return;
      setMacroSaving(true);
      try {
        const updated = await editorSettingsAPI.updateMacros([
          { name, expansion },
        ]);
        setMacros(updated);
        setEditingMacro(null);
        toast.success(`Macro \\${name} saved`);
      } catch {
        toast.error("Failed to save macro");
      } finally {
        setMacroSaving(false);
      }
    },
    [isAuthenticated],
  );

  const handleResetMacro = useCallback(
    async (name: string) => {
      if (!isAuthenticated) return;
      setMacroSaving(true);
      try {
        const updated = await editorSettingsAPI.resetMacro(name);
        setMacros(updated);
        toast.success(`Macro \\${name} reset to default`);
      } catch {
        toast.error("Failed to reset macro");
      } finally {
        setMacroSaving(false);
      }
    },
    [isAuthenticated],
  );

  const handleResetAll = useCallback(async () => {
    if (!isAuthenticated) return;
    setMacroSaving(true);
    try {
      const updated = await editorSettingsAPI.resetMacro();
      setMacros(updated);
      toast.success("All macros reset to defaults");
    } catch {
      toast.error("Failed to reset macros");
    } finally {
      setMacroSaving(false);
    }
  }, [isAuthenticated]);

  const handleAddMacro = useCallback(async () => {
    if (!isAuthenticated || !newName.trim() || !newExpansion.trim()) return;
    setMacroSaving(true);
    try {
      const updated = await editorSettingsAPI.updateMacros([
        { name: newName.trim(), expansion: newExpansion.trim() },
      ]);
      setMacros(updated);
      setAddingMacro(false);
      setNewName("");
      setNewExpansion("");
      toast.success(`Macro \\${newName.trim()} created`);
    } catch {
      toast.error("Failed to add macro");
    } finally {
      setMacroSaving(false);
    }
  }, [isAuthenticated, newName, newExpansion]);

  const handleDeleteMacro = useCallback(
    async (name: string) => {
      if (!isAuthenticated) return;
      setMacroSaving(true);
      try {
        // Update with empty expansion to trigger deletion, or reset
        const updated = await editorSettingsAPI.resetMacro(name);
        setMacros(updated);
        toast.success(`Macro \\${name} deleted`);
      } catch {
        toast.error("Failed to delete macro");
      } finally {
        setMacroSaving(false);
      }
    },
    [isAuthenticated],
  );

  const filteredMacros = useMemo(() => {
    const q = macroSearch.toLowerCase().trim();
    if (!q) return macros;
    return macros.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.expansion.toLowerCase().includes(q),
    );
  }, [macros, macroSearch]);

  const customCount = useMemo(
    () => macros.filter((m) => m.isCustom).length,
    [macros],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="wide"
        className="p-0 overflow-hidden gap-0 border-line/50 bg-background"
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>Settings</DialogTitle>
        </VisuallyHidden>
        {loading ? (
          <div className="flex items-center justify-center h-[620px]">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex h-[620px]">
            {/* ── Side Navigation ── */}
            <div className="flex w-[200px] shrink-0 flex-col gap-0.5 border-e border-line bg-panel p-3">
              <h2 className="px-2.5 pb-3 pt-1 text-base font-semibold text-foreground">Settings</h2>
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={isActive ? "page" : undefined}
                    title={tab.description}
                    className={cn("flex h-10 items-center gap-2.5 rounded-[var(--radius)] px-2.5 text-start type-base font-medium transition-colors", isActive ? "bg-surface-hover text-foreground" : "text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground")}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* ── Content Area ── */}
            <LongScroll
              fill
              className="flex-1 min-w-0"
              scrollClassName="scrollbar-hidden p-5"
            >
              {/* Editor Tab */}
              {activeTab === "editor" && (
                <div className="space-y-1">
                  <TabHeader
                    title="Editor"
                    description="Configure code editing behavior and assistance."
                  />
                  <SettingSection title="Editing">
                    <SettingRow
                      label="Auto-complete"
                      description="Suggest completions as you type"
                    >
                      <Switch
                        checked={editorSettings.autoComplete}
                        onCheckedChange={(v) =>
                          updateEditor({ autoComplete: v })
                        }
                      />
                    </SettingRow>
                    <SettingRow
                      label="Auto-close brackets"
                      description="Automatically close brackets and quotes"
                    >
                      <Switch
                        checked={editorSettings.autoCloseBrackets}
                        onCheckedChange={(v) =>
                          updateEditor({ autoCloseBrackets: v })
                        }
                      />
                    </SettingRow>
                    <SettingRow
                      label="Smart indentation"
                      description="Indent based on LaTeX environment nesting"
                    >
                      <Switch
                        checked={editorSettings.autoIndent}
                        onCheckedChange={(v) => updateEditor({ autoIndent: v })}
                      />
                    </SettingRow>
                    <SettingRow
                      label="Tab size"
                      description="Spaces per indent level (shared by all collaborators)"
                    >
                      <Select
                        value={String(projectSettings.tabSize ?? 4)}
                        onValueChange={(v) => {
                          const newSize = parseInt(v, 10);
                          const oldSize = projectSettings.tabSize ?? 4;
                          updateProject({ tabSize: newSize });
                          if (oldSize !== newSize && onReindentProject) {
                            onReindentProject(oldSize, newSize);
                          }
                        }}
                      >
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2">2 spaces</SelectItem>
                          <SelectItem value="4">4 spaces</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingRow>
                  </SettingSection>
                  <SettingSection title="Checking">
                    <SettingRow
                      label="Syntax checking"
                      description="Highlight LaTeX syntax errors"
                    >
                      <Switch
                        checked={editorSettings.codeCheck}
                        onCheckedChange={(v) => updateEditor({ codeCheck: v })}
                      />
                    </SettingRow>
                    <SettingRow
                      label="Spell check"
                      description="Right-click an underlined word for suggestions"
                    >
                      <Select
                        value={editorSettings.spellcheckLang}
                        onValueChange={(v) =>
                          updateEditor({ spellcheckLang: v })
                        }
                      >
                        <SelectTrigger className="w-[170px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="en">English (US)</SelectItem>
                          <SelectItem value="en-GB">English (UK)</SelectItem>
                          <SelectItem value="fr">French</SelectItem>
                          <SelectItem value="de">German</SelectItem>
                          <SelectItem value="it">Italian</SelectItem>
                          <SelectItem value="pt">Portuguese (Brazil)</SelectItem>
                          <SelectItem value="es">Spanish</SelectItem>
                          <SelectItem value="off">Off</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingRow>
                    <SettingRow
                      label="Dictionary"
                      description="Manage custom words"
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-[var(--control-height)] type-base"
                        onClick={() => onOpenDictionary?.()}
                      >
                        Manage words…
                      </Button>
                    </SettingRow>
                  </SettingSection>
                </div>
              )}

              {/* Compiler Tab */}
              {activeTab === "compiler" && (
                <div className="space-y-1">
                  <TabHeader
                    title="Compiler"
                    description="Configure how your LaTeX documents are compiled."
                  />
                  <SettingSection title="Document">
                    <SettingRow
                      label="Main document"
                      description="Entry point for compilation"
                    >
                      <Select
                        value={projectSettings.mainDocument}
                        onValueChange={(v) =>
                          updateProject({ mainDocument: v })
                        }
                      >
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {projectFiles
                            .filter((f) => f.path.endsWith(".tex"))
                            .map((f) => (
                              <SelectItem key={f.id} value={f.path}>
                                {f.path}
                              </SelectItem>
                            ))}
                          {projectFiles.filter((f) => f.path.endsWith(".tex"))
                            .length === 0 && (
                            <SelectItem value="main.tex">main.tex</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </SettingRow>
                  </SettingSection>
                  <SettingSection title="Engine">
                    <SettingRow
                      label="Compiler"
                      description="LaTeX engine to use"
                    >
                      <Select
                        value={projectSettings.compiler}
                        onValueChange={(v) => updateProject({ compiler: v })}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pdflatex">pdfLaTeX</SelectItem>
                          <SelectItem value="xelatex">XeLaTeX</SelectItem>
                          <SelectItem value="lualatex">LuaLaTeX</SelectItem>
                          <SelectItem value="latex">LaTeX</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingRow>
                  </SettingSection>
                  <SettingSection title="Compilation">
                    <SettingRow
                      label="Compile mode"
                      description="Draft draws images as empty boxes, which is faster for long documents"
                    >
                      <Segmented
                        value={projectSettings.compileMode}
                        onValueChange={(v) => updateProject({ compileMode: v })}
                        label="Compile mode"
                        options={[
                          { value: "normal", label: "Normal" },
                          { value: "draft", label: "Draft" },
                        ]}
                      />
                    </SettingRow>
                    <SettingRow
                      label="Stop on first error"
                      description="Halt compilation on first error"
                    >
                      <Switch
                        checked={projectSettings.stopOnFirstError}
                        onCheckedChange={(v) =>
                          updateProject({ stopOnFirstError: v })
                        }
                      />
                    </SettingRow>
                    <SettingRow
                      label="Auto-compile"
                      description="Compile on save automatically"
                    >
                      <Switch
                        checked={projectSettings.autoCompile}
                        onCheckedChange={(v) =>
                          updateProject({ autoCompile: v })
                        }
                      />
                    </SettingRow>
                  </SettingSection>
                </div>
              )}

              {/* Appearance Tab */}
              {activeTab === "appearance" && (
                <div className="space-y-1">
                  <TabHeader
                    title="Appearance"
                    description="Customize the editor's look and feel."
                  />
                  <SettingSection title="Theme">
                    <SettingRow
                      label="Interface theme"
                      description="Overall interface theme"
                    >
                      <Select
                        value={editorSettings.theme}
                        onValueChange={(v) => updateEditor({ theme: v })}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dark">Dark</SelectItem>
                          <SelectItem value="light">Light</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingRow>
                    <SettingRow label="Editor theme" description="The colors of the source. Thry follows the interface's light and dark modes.">
                      <Select value={editorSettings.editorTheme} onValueChange={(v) => updateEditor({ editorTheme: v })}>
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          {(["both", "dark", "light"] as const).map((kind) => (
                            <SelectGroup key={kind}>
                              <SelectLabel>{kind === "both" ? "Ours" : kind === "dark" ? "Dark" : "Light"}</SelectLabel>
                              {EDITOR_THEMES.filter((theme) => theme.type === kind).map((theme) => (
                                <SelectItem key={theme.id} value={theme.id}>
                                  {theme.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </SettingRow>
                    <SettingRow
                      label="PDF theme"
                      description="PDF preview appearance"
                    >
                      <Select
                        value={editorSettings.pdfTheme}
                        onValueChange={(v) => updateEditor({ pdfTheme: v })}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="dark">Dark</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingRow>
                  </SettingSection>
                  <SettingSection title="Typography">
                    <SettingRow
                      label="Font family"
                      description="Editor typeface"
                    >
                      <Select
                        value={editorSettings.fontFamily}
                        onValueChange={(v) => updateEditor({ fontFamily: v })}
                      >
                        <SelectTrigger className="w-[155px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Consolas">Consolas</SelectItem>
                          <SelectItem value="JetBrains Mono">
                            JetBrains Mono
                          </SelectItem>
                          <SelectItem value="Fira Code">Fira Code</SelectItem>
                          <SelectItem value="Source Code Pro">
                            Source Code Pro
                          </SelectItem>
                          <SelectItem value="Monaco">Monaco</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingRow>
                    <SettingRow
                      label={`Font size: ${editorSettings.fontSize}px`}
                      description="Text size in editor"
                    >
                      <Slider
                        className="w-[130px]"
                        min={10}
                        max={24}
                        step={1}
                        value={[editorSettings.fontSize]}
                        onValueChange={([v]) => updateEditor({ fontSize: v })}
                      />
                    </SettingRow>
                    <SettingRow
                      label="Line height"
                      description="Spacing between lines"
                    >
                      <Segmented
                        value={editorSettings.lineHeight}
                        onValueChange={(v) => updateEditor({ lineHeight: v })}
                        label="Line height"
                        options={[
                          { value: "compact", label: "Compact" },
                          { value: "normal", label: "Normal" },
                          { value: "wide", label: "Wide" },
                        ]}
                      />
                    </SettingRow>
                  </SettingSection>
                </div>
              )}

              {/* Macros Tab */}
              {activeTab === "macros" && (
                <div className="flex flex-col h-full gap-3">
                  <div className="mb-4">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-base font-semibold text-foreground">
                        Macros
                      </h3>
                    </div>
                    <div className="flex items-center justify-between gap-4 mt-0.5">
                      <p className="type-small text-muted-foreground">
                        Define LaTeX command shortcuts. Changes are saved to
                        your account.{" "}
                        <span
                          className="inline-flex items-center justify-center size-4 rounded-full bg-surface/60 text-muted-foreground type-micro font-bold cursor-help align-middle"
                          title="Macros generate \providecommand{\name}{expansion} in your preamble when used. Your own \newcommand definitions always take priority. Use #1, #2 for arguments."
                        >
                          ?
                        </span>
                      </p>
                      <Switch
                        checked={projectSettings.macrosEnabled ?? true}
                        onCheckedChange={(v) =>
                          updateProject({ macrosEnabled: v })
                        }
                        className="data-[state=checked]:bg-success data-[state=unchecked]:bg-hue-red"
                      />
                    </div>
                  </div>

                  {/* Toolbar */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        placeholder="Search macros..."
                        value={macroSearch}
                        onChange={(e) => setMacroSearch(e.target.value)}
                        className="h-[var(--control-height)] ps-9 type-base"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={() => {
                        setAddingMacro(true);
                        setNewName("");
                        setNewExpansion("");
                      }}
                    >
                      <Plus className="size-4" />
                      Add
                    </Button>
                    {customCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground hover:text-danger shrink-0"
                        onClick={handleResetAll}
                        disabled={macroSaving}
                      >
                        <RotateCcw className="size-4" />
                        Reset all
                      </Button>
                    )}
                  </div>

                  {/* Stats bar */}
                  <div className="flex items-center gap-3 type-small text-muted-foreground px-1">
                    <span>{macros.length} macros</span>
                    {customCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Sparkles className="size-4 text-foreground" />
                        {customCount} customized
                      </span>
                    )}
                  </div>

                  {/* Add macro form */}
                  {addingMacro && (
                    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
                      <div className="type-small font-medium text-foreground">
                        New Macro
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span className="type-small text-muted-foreground font-mono">
                            \
                          </span>
                          <Input
                            placeholder="name"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="h-[var(--control-height)] type-base font-mono flex-1"
                            autoFocus
                          />
                        </div>
                        <span className="type-small text-muted-foreground">→</span>
                        <Input
                          placeholder="expansion"
                          value={newExpansion}
                          onChange={(e) => setNewExpansion(e.target.value)}
                          className="h-[var(--control-height)] type-base font-mono flex-1"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddMacro();
                          }}
                        />
                        <Button
                          size="sm"
                          className="size-8 p-0"
                          onClick={handleAddMacro}
                          disabled={
                            macroSaving ||
                            !newName.trim() ||
                            !newExpansion.trim()
                          }
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="size-8 p-0"
                          onClick={() => setAddingMacro(false)}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Macro list */}
                  <div className="flex-1 min-h-0 overflow-y-auto scrollbar-modern space-y-0.5 pe-1">
                    {filteredMacros.length === 0 ? (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        {macroSearch
                          ? "No macros match your search."
                          : "No macros defined."}
                      </div>
                    ) : (
                      filteredMacros.map((macro) => {
                        const isEditing = editingMacro === macro.name;
                        return (
                          <div
                            key={macro.name}
                            className={cn(
                              "group flex items-center gap-2 rounded-[var(--radius)] px-2.5 py-1 min-h-10 type-base transition-colors",
                              isEditing
                                ? "bg-surface-hover/80 border border-line/60"
                                : "hover:bg-surface-hover/40",
                              macro.isCustom &&
                                !isEditing &&
                                "border-s-2 border-s-accent/50",
                            )}
                          >
                            {isEditing ? (
                              <>
                                <span className="text-muted-foreground font-mono shrink-0">
                                  \
                                </span>
                                <Input
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className="h-8 type-small font-mono w-[80px] shrink-0"
                                />
                                <span className="text-muted-foreground shrink-0">
                                  →
                                </span>
                                <Input
                                  value={editExpansion}
                                  onChange={(e) =>
                                    setEditExpansion(e.target.value)
                                  }
                                  className="h-8 type-small font-mono flex-1 min-w-0"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      handleSaveMacro(editName, editExpansion);
                                    }
                                    if (e.key === "Escape")
                                      setEditingMacro(null);
                                  }}
                                />
                                <Button
                                  size="sm"
                                  className="size-8 p-0 shrink-0"
                                  onClick={() =>
                                    handleSaveMacro(editName, editExpansion)
                                  }
                                  disabled={macroSaving}
                                >
                                  <Check className="size-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="size-8 p-0 shrink-0"
                                  onClick={() => setEditingMacro(null)}
                                >
                                  <X className="size-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <code className="font-mono text-foreground shrink-0 min-w-[70px]">
                                  \{macro.name}
                                </code>
                                <span className="text-muted-foreground/60 shrink-0">
                                  →
                                </span>
                                <code className="font-mono text-muted-foreground truncate flex-1 min-w-0">
                                  {macro.expansion}
                                </code>
                                {macro.isCustom && (
                                  <span className="shrink-0 rounded-full bg-accent/15 text-foreground type-micro px-1.5 py-0.5 font-medium">
                                    custom
                                  </span>
                                )}
                                <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="size-8 p-0"
                                    onClick={() => {
                                      setEditingMacro(macro.name);
                                      setEditName(macro.name);
                                      setEditExpansion(macro.expansion);
                                    }}
                                  >
                                    <Pencil className="size-4" />
                                  </Button>
                                  {macro.isCustom && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="size-8 p-0 text-muted-foreground hover:text-danger"
                                      onClick={() =>
                                        handleResetMacro(macro.name)
                                      }
                                      title="Reset to default"
                                    >
                                      <RotateCcw className="size-4" />
                                    </Button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Snippets Tab */}
              {activeTab === "assistant" && (
                <div className="flex flex-col gap-8">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-base font-semibold text-foreground">Keys and models</h3>
                      <p className="type-small text-muted-foreground">
                        Axya uses your own API key. Usage is on the{" "}
                        <a href="/ai" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
                          AI page
                        </a>
                        .
                      </p>
                    </div>
                    <AiProviderSettings heading={false} />
                  </div>
                  <AssistantCommandsSettings />
                </div>
              )}

              {activeTab === "snippets" && (
                <div className="space-y-1">
                  <div className="pb-2">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-base font-semibold text-foreground">
                        Snippets
                      </h3>
                    </div>
                    <div className="flex items-center justify-between gap-4 mt-0.5">
                      <p className="type-small text-muted-foreground">
                        Templates available in the Shift+Space insert palette.
                      </p>
                      <Switch
                        checked={projectSettings.snippetsEnabled ?? true}
                        onCheckedChange={(v) =>
                          updateProject({ snippetsEnabled: v })
                        }
                        className="data-[state=checked]:bg-success data-[state=unchecked]:bg-hue-red"
                      />
                    </div>
                  </div>
                  {[...new Set(LATEX_SNIPPETS.map((s) => s.category))].map(
                    (cat: string) => {
                      const snippets = LATEX_SNIPPETS.filter(
                        (s) => s.category === cat,
                      );
                      if (snippets.length === 0) return null;
                      return (
                        <SettingSection key={cat} title={cat}>
                          {snippets.map((snippet) => (
                            <details key={snippet.label} className="group">
                              <summary className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                                <div className="flex items-center gap-2 min-w-0">
                                  <ChevronRight className="size-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
                                  <span className="text-sm font-medium text-foreground truncate">
                                    {snippet.label}
                                  </span>
                                </div>
                                {snippet.description && (
                                  <span className="type-small text-muted-foreground truncate shrink-0">
                                    {snippet.description}
                                  </span>
                                )}
                              </summary>
                              <div className="px-3 pb-2 pt-1">
                                <pre className="type-small font-mono text-muted-foreground bg-surface/30 border border-line/30 rounded-md p-2.5 overflow-x-auto whitespace-pre leading-relaxed max-h-[200px] overflow-y-auto scrollbar-hidden">
                                  {snippet.template}
                                </pre>
                              </div>
                            </details>
                          ))}
                        </SettingSection>
                      );
                    },
                  )}
                </div>
              )}
            </LongScroll>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Helper Components ──

function TabHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="type-small text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}

function SettingSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="type-small font-medium text-muted-foreground mb-2">
        {title}
      </div>
      <div className="rounded-lg border border-line/40 bg-card/50 divide-y divide-line/30">
        {children}
      </div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <div className="min-w-0">
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        {description && (
          <p className="type-small text-muted-foreground mt-0.5">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
