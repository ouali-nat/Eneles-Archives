"use client";

import { memo, useEffect, useCallback, useMemo } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { searchCommands, type EditorCommand } from "@/lib/editor/commands";
import { Play, FileCode, GitGraph, Settings, Save, PanelLeft, PanelRight, PanelBottom, PenTool, Braces, Sigma, Sparkles, MessageSquare, MessagesSquare, LayoutTemplate, History } from "@/components/icons";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert?: (text: string) => void;
  /** A TikZ example: the figure at the cursor, and what it needs in the preamble. Without it, TikZ examples go through onInsert. */
  onInsertTikz?: (source: string) => void;
  onAction?: (action: string) => void;
  search: string;
  setSearch: (s: string) => void;
}

/** Memoised: it is drawn by the editor screen, which re-renders on every keystroke, and only needs drawing again when its own props change. */
export const CommandPalette = memo(function CommandPalette({
  open,
  onOpenChange,
  onInsert,
  onInsertTikz,
  onAction,
  search,
  setSearch,
}: CommandPaletteProps) {
  const filtered = useMemo(() => searchCommands(search), [search]);

  const actions = useMemo(
    () => filtered.filter((c) => c.category === "action"),
    [filtered],
  );
  const snippets = useMemo(
    () => filtered.filter((c) => c.category === "snippet"),
    [filtered],
  );
  const tikz = useMemo(
    () => filtered.filter((c) => c.category === "tikz"),
    [filtered],
  );

  const handleSelect = useCallback(
    (cmd: EditorCommand) => {
      if (cmd.action && onAction) {
        onAction(cmd.action);
      } else if (cmd.template && cmd.category === "tikz" && onInsertTikz) {
        onInsertTikz(cmd.template);
      } else if (cmd.template && onInsert) {
        onInsert(cmd.template);
      }
      onOpenChange(false);
    },
    [onAction, onInsert, onInsertTikz, onOpenChange],
  );

  // Ctrl+K / Cmd+K
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onOpenChange]);

  const iconForCommand = (cmd: EditorCommand) => {
    if (cmd.action) {
      switch (cmd.action) {
        case "compile":
          return Play;
        case "save":
          return Save;
        case "toggleFileTree":
          return PanelLeft;
        case "togglePdf":
          return PanelRight;
        case "toggleLogs":
          return PanelBottom;
        case "toggleAssistant":
          return Sparkles;
        case "toggleReview":
          return MessageSquare;
        case "toggleChat":
          return MessagesSquare;
        case "fileHistory":
          return History;
        case "resetLayout":
          return LayoutTemplate;
        case "toggleDrawing":
          return PenTool;
        case "openSettings":
          return Settings;
        default:
          return FileCode;
      }
    }
    if (cmd.category === "tikz") return GitGraph;
    return cmd.label.includes("math") || cmd.label.includes("Equation")
      ? Sigma
      : Braces;
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search snippets, TikZ templates, and actions. Type to filter."
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder="Search commands, TikZ templates..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[min(70vh,400px)]">
        <CommandEmpty>No results found.</CommandEmpty>

        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((cmd) => {
              const Icon = iconForCommand(cmd);
              return (
                <CommandItem
                  key={cmd.id}
                  value={[cmd.label, cmd.description, ...cmd.keywords]
                    .filter(Boolean)
                    .join(" ")}
                  onSelect={() => handleSelect(cmd)}
                  className="gap-2"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{cmd.label}</span>
                  {cmd.shortcut && (
                    <span className="ms-auto text-xs text-muted-foreground font-mono">
                      {cmd.shortcut}
                    </span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {snippets.length > 0 && (
          <>
            {actions.length > 0 && <CommandSeparator />}
            <CommandGroup heading="LaTeX Snippets">
              {snippets.slice(0, 30).map((cmd) => {
                const Icon = iconForCommand(cmd);
                return (
                  <CommandItem
                    key={cmd.id}
                    value={[cmd.label, cmd.description, ...cmd.keywords]
                      .filter(Boolean)
                      .join(" ")}
                    onSelect={() => handleSelect(cmd)}
                    className="gap-2"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <span className="block truncate">{cmd.label}</span>
                      {cmd.description && (
                        <span className="text-xs text-muted-foreground truncate block">
                          {cmd.description}
                        </span>
                      )}
                    </div>
                    {cmd.shortcut && (
                      <span className="ms-auto text-xs text-muted-foreground font-mono shrink-0">
                        {cmd.shortcut}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {snippets.length > 30 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                +{snippets.length - 30} more. Refine your search.
              </p>
            )}
          </>
        )}

        {tikz.length > 0 && (
          <>
            {(actions.length > 0 || snippets.length > 0) && (
              <CommandSeparator />
            )}
            <CommandGroup heading="TikZ Templates">
              {tikz.slice(0, 25).map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={[cmd.label, cmd.description, ...cmd.keywords]
                    .filter(Boolean)
                    .join(" ")}
                  onSelect={() => handleSelect(cmd)}
                  className="gap-2"
                >
                  <GitGraph className="h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <span className="block truncate">{cmd.label}</span>
                    {cmd.description && (
                      <span className="text-xs text-muted-foreground truncate block">
                        {cmd.description}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {tikz.length > 25 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                +{tikz.length - 25} more TikZ templates. Refine your search.
              </p>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
});
