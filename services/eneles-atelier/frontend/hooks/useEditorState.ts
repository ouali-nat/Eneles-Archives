"use client";

import { useState, useCallback, useEffect } from "react";
import type { EditorSettings, ProjectSettings } from "@/lib/api";
import { projectsAPI, editorSettingsAPI } from "@/lib/api";
import { useTheme } from "next-themes";
import {
  isEditorTheme,
  EDITOR_THEME_STORAGE_KEY,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
} from "@/lib/editor/themes";

export function useEditorState({
  projectId,
  isAuthenticated,
  initialSettings,
}: {
  projectId: string;
  isAuthenticated: boolean;
  initialSettings?: EditorSettings | null;
}) {
  const { resolvedTheme } = useTheme();

  // Project settings (compiler version, etc.)
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

  // Editor settings (user preferences)
  const [editorSettings, setEditorSettings] = useState<EditorSettings | null>(
    initialSettings ?? null,
  );

  // Theme
  const [editorThemeId, setEditorThemeId] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_DARK_THEME;
    const stored = localStorage.getItem(EDITOR_THEME_STORAGE_KEY);
    if (isEditorTheme(stored)) return stored;
    return resolvedTheme === "light" ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
  });

  // The choice belongs to the account, so it is the same on every device; the browser keeps a copy only so the editor opens in the right colors before the account's settings arrive.
  const applyEditorTheme = useCallback((id: string) => {
    setEditorThemeId(id);
    localStorage.setItem(EDITOR_THEME_STORAGE_KEY, id);
  }, []);
  const updateEditorTheme = useCallback(
    (id: string) => {
      applyEditorTheme(id);
      setEditorSettings((prev) => (prev ? { ...prev, editorTheme: id } : prev));
      if (isAuthenticated) editorSettingsAPI.updateEditorSettings({ editorTheme: id }).catch(console.error);
    },
    [applyEditorTheme, isAuthenticated],
  );

  // Fetch settings if isAuthenticated exists
  useEffect(() => {
    if (!isAuthenticated) return;
    projectsAPI
      .getProjectSettings(projectId)
      .then(setProjectSettings)
      .catch(console.error);
    editorSettingsAPI
      .getEditorSettings()
      .then((serverSettings) => {
        // Restore client-side-only fields from localStorage:
        // the backend doesn't store them so they'd be lost otherwise.
        const savedAutoIndent =
          typeof window !== "undefined"
            ? localStorage.getItem("texer:autoIndent")
            : null;
        setEditorSettings(
          (prev) =>
            ({
              ...(prev ?? {}),
              ...serverSettings,
              autoIndent:
                savedAutoIndent !== null
                  ? savedAutoIndent === "true"
                  : (prev?.autoIndent ?? false),
            }) as EditorSettings,
        );
        // The account's theme wins over whatever this browser last used.
        if (isEditorTheme(serverSettings.editorTheme)) applyEditorTheme(serverSettings.editorTheme);
      })
      .catch(console.error);
  }, [isAuthenticated, projectId, applyEditorTheme]);

  return {
    projectSettings,
    setProjectSettings,
    editorSettings,
    setEditorSettings,
    editorThemeId,
    updateEditorTheme,
  };
}
