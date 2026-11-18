"use client";

import { BookOpen, Bold, Italic, Code, ImageIcon, List, ListOrdered, Sigma, ChevronDown, Underline, Braces, Palette, Check, PenTool, Zap } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { memo, useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { EDITOR_THEMES } from "@/lib/editor/themes";
import { THEME_SWATCHES } from "@/lib/editor/theme-swatches";
import { TablePicker, makeTable } from "@/components/editor/TablePicker";
import { TikzTemplatePicker } from "@/components/editor/tikz/TikzTemplatePicker";
import { splitTikzSource } from "@/lib/tikz/insert";

interface EditorRibbonProps {
  onInsertSnippet: (text: string) => void;
  editorThemeId?: string;
  onEditorThemeChange?: (themeId: string) => void;
  onToggleDrawing?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenInsertPalette?: () => void;
  /** Look up a DOI or arXiv ID and add it to a .bib file. */
  onAddReference?: () => void;
  /** Insert a TikZ library example: the figure at the cursor, and the packages and libraries it needs in the main document's preamble. */
  onInsertTikz?: (source: string) => void;
  /** Code shows the LaTeX; visual draws it. */
  editorMode?: "code" | "visual";
  onEditorModeChange?: (mode: "code" | "visual") => void;
}

function RibbonButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={onClick}
      title={label}
    >
      <Icon className="size-4" />
    </Button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-line mx-0.5 shrink-0 self-center" />;
}

/** The editor's formatting bar. Memoised: the editor screen re-renders on every keystroke, and this bar (with its TikZ gallery and table picker) only needs to when its own props change. */
export const EditorRibbon = memo(function EditorRibbon({
  onInsertSnippet,
  editorThemeId,
  onEditorThemeChange,
  onToggleDrawing,
  onAddReference,
  onInsertTikz,
  editorMode,
  onEditorModeChange,
  onOpenCommandPalette,
  onOpenInsertPalette,
}: EditorRibbonProps) {
  // The tab the menu opens on: the current theme's kind, or for a theme that follows the site (Thry), the site's mode.
  const { resolvedTheme } = useTheme();
  const currentType = EDITOR_THEMES.find((t) => t.id === editorThemeId)?.type ?? "both";
  const activeThemeTab: "dark" | "light" = currentType === "both" ? (resolvedTheme === "light" ? "light" : "dark") : currentType;
  const [themeTab, setThemeTab] = useState<"dark" | "light">(activeThemeTab);
  // Follow the active theme's tab whenever the theme changes; between changes the tab is the reader's to switch.
  const [prevActiveThemeTab, setPrevActiveThemeTab] = useState(activeThemeTab);
  if (prevActiveThemeTab !== activeThemeTab) {
    setPrevActiveThemeTab(activeThemeTab);
    setThemeTab(activeThemeTab);
  }

  return (
    <div className="editor-bar flex items-center gap-0.5 px-2 border-b border-line bg-surface/30 overflow-x-auto scrollbar-hidden shrink-0">
      {editorMode && onEditorModeChange && (
        <>
          <Segmented
            value={editorMode}
            onValueChange={onEditorModeChange}
            options={[
              { value: "code", label: "Code" },
              { value: "visual", label: "Visual" },
            ]}
            label="Editor mode"
            className="me-1 shrink-0"
          />
          <Divider />
        </>
      )}
      {/* ── Format ── */}
      <RibbonButton
        icon={Bold}
        label="Bold (Ctrl+B)"
        onClick={() => onInsertSnippet("\\textbf{}")}
      />
      <RibbonButton
        icon={Italic}
        label="Italic (Ctrl+I)"
        onClick={() => onInsertSnippet("\\textit{}")}
      />
      <RibbonButton
        icon={Underline}
        label="Underline"
        onClick={() => onInsertSnippet("\\underline{}")}
      />
      <RibbonButton
        icon={Code}
        label="Monospace"
        onClick={() => onInsertSnippet("\\texttt{}")}
      />

      <Divider />

      {/* ── Math ── */}
      <RibbonButton
        icon={Sigma}
        label="Inline math ($…$)"
        onClick={() => onInsertSnippet("$$")}
      />
      <RibbonButton
        icon={Braces}
        label="Display math"
        onClick={() => onInsertSnippet("\\[\n  \n\\]")}
      />

      <Divider />

      {/* ── Lists ── */}
      <RibbonButton
        icon={List}
        label="Bullet list"
        onClick={() =>
          onInsertSnippet("\\begin{itemize}\n  \\item \n\\end{itemize}")
        }
      />
      <RibbonButton
        icon={ListOrdered}
        label="Numbered list"
        onClick={() =>
          onInsertSnippet("\\begin{enumerate}\n  \\item \n\\end{enumerate}")
        }
      />

      <Divider />

      {/* ── Table (grid picker) ── */}
      <TablePicker
        onInsert={(rows, cols) => onInsertSnippet(makeTable(rows, cols))}
      />

      {/* ── Figure ── */}
      <RibbonButton
        icon={ImageIcon}
        label="Figure"
        onClick={() =>
          onInsertSnippet(
            "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}",
          )
        }
      />

      <Divider />

      {/* ── TikZ: separated into two standalone buttons ── */}
      {/* TikZ template: a gallery of the library's diagrams; without the preamble handler, only the figure is inserted. */}
      <TikzTemplatePicker onInsert={(source) => (onInsertTikz ? onInsertTikz(source) : onInsertSnippet(splitTikzSource(source).body))} />
      {onAddReference && (
        <RibbonButton icon={BookOpen} label="Add a reference by DOI or arXiv ID" onClick={onAddReference} />
      )}
      {/* TikZ drawing tool (opens DrawingPanel) */}
      {onToggleDrawing && (
        <RibbonButton
          icon={PenTool}
          label="TikZ drawing tool"
          onClick={onToggleDrawing}
        />
      )}

      <Divider />

      {/* ── Insert palette (Shift+Space): lives here as a trigger ── */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 px-2"
        title="Insert snippet (Shift+Space)"
        onClick={() => onOpenInsertPalette?.()}
      >
        <Zap className="size-4" />
        <ChevronDown className="size-3 opacity-50" />
      </Button>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Theme picker ── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 px-2"
            aria-label="Editor theme"
            title="Editor theme"
          >
            <Palette aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-72 p-0"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Dark and light themes, each with a sample of itself: its background and its four main syntax colors, so a theme can be judged before it is chosen. */}
          <div className="border-b border-line p-2">
            <Segmented<"dark" | "light">
              value={themeTab}
              onValueChange={setThemeTab}
              label="Theme kind"
              className="w-full [&>*]:flex-1"
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {EDITOR_THEMES.filter((t) => t.type === themeTab || t.type === "both").map((theme) => {
              const [background, ...colors] = THEME_SWATCHES[theme.id] ?? [];
              return (
                <DropdownMenuItem key={theme.id} onClick={() => onEditorThemeChange?.(theme.id)} className="min-h-10 gap-3 px-2">
                  <span aria-hidden className="flex h-6 w-14 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-inset)] border border-line bg-[var(--sample)]" style={{ "--sample": background } as React.CSSProperties}>
                    {colors.map((color, i) => (
                      <span key={i} className="size-2 rounded-full bg-[var(--sample)]" style={{ "--sample": color } as React.CSSProperties} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {theme.label}
                    {theme.type === "both" && <span className="ms-2 type-small text-muted-foreground">Follows the site</span>}
                  </span>
                  {editorThemeId === theme.id && <Check className="size-4 shrink-0 text-foreground" />}
                </DropdownMenuItem>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
