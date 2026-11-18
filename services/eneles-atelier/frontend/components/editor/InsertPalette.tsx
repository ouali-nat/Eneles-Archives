"use client";

import { memo, useEffect, useCallback, useMemo, useState, useRef } from "react";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getSnippetsByCategory,
  SNIPPET_CATEGORIES,
} from "@/lib/latex/snippets";
import type { SnippetCategory } from "@/lib/latex/snippets";
import { tikzLibraries } from "@/lib/tikz/libraries";
import { splitTikzSource } from "@/lib/tikz/insert";
import { ChevronRight, PlusCircle } from "@/components/icons";
import { Kbd, kbdClass } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { LongScroll } from "@/components/essential/layout/LongScroll";
import { TikzThumb } from "@/components/essential/library/TikzThumb";

interface InsertPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert?: (text: string) => void;
  /** Insert a TikZ library example with what it needs in the preamble; without it, only the figure is inserted. */
  onInsertTikz?: (source: string) => void;
  cursorCoords?: { left: number; top: number; bottom: number } | null;
  getCursorCoords?: () => { left: number; top: number; bottom: number } | null;
}

type PathSegment = SnippetCategory | string;

interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  icon: "file" | "math" | "braces" | "graph";
  isFolder: boolean;
  onSelect: () => void;
  /** A TikZ figure to render beside the list while this item is highlighted. */
  preview?: { libraryId: string; exampleId: string; source: string; name: string };
}

function searchFilter<T>(
  items: T[],
  query: string,
  getSearchable: (t: T) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => getSearchable(item).toLowerCase().includes(q));
}

/** Memoised: it is drawn by the editor screen, which re-renders on every keystroke, and only needs drawing again when its own props change. */
export const InsertPalette = memo(function InsertPalette({
  open,
  onOpenChange,
  onInsert,
  onInsertTikz,
  cursorCoords,
  getCursorCoords,
}: InsertPaletteProps) {
  const [path, setPath] = useState<PathSegment[]>([]);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [keyboardCoords, setKeyboardCoords] = useState<{
    left: number;
    top: number;
    bottom: number;
  } | null>(null);
  const liveCoords = cursorCoords ?? keyboardCoords;
  // Closing clears the cursor position at once, but the palette is still on screen for its closing animation. It stays where it last was instead of jumping to the corner of the window.
  const [lastCoords, setLastCoords] = useState(liveCoords);
  if (liveCoords && (liveCoords.left !== lastCoords?.left || liveCoords.bottom !== lastCoords?.bottom)) setLastCoords(liveCoords);
  const anchorCoords = liveCoords ?? lastCoords;
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  const resetOnClose = useCallback(() => {
    setPath([]);
    setSearch("");
    setSelectedIndex(0);
    setKeyboardCoords(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetOnClose();
      else setKeyboardCoords(null);
      onOpenChange(next);
    },
    [onOpenChange, resetOnClose],
  );

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === " ") {
        const active = document.activeElement;
        const isInEditor = active?.closest(".cm-editor") != null;
        if (!isInEditor) return;
        e.preventDefault();
        e.stopPropagation();
        if (!open) {
          const coords = getCursorCoords?.() ?? null;
          setKeyboardCoords(coords);
        }
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", fn, true);
    return () => window.removeEventListener("keydown", fn, true);
  }, [open, onOpenChange, getCursorCoords]);

  const goBack = useCallback(() => {
    setPath((p) => p.slice(0, -1));
    setSelectedIndex(0);
  }, []);

  const handleInsert = useCallback(
    (text: string) => {
      onInsert?.(text);
      handleOpenChange(false);
    },
    [onInsert, handleOpenChange],
  );

  const isRoot = path.length === 0;
  const currentCategory = path[0] as SnippetCategory | undefined;

  const rootCategories = useMemo((): SnippetCategory[] => {
    return searchFilter(
      [...SNIPPET_CATEGORIES],
      search,
      (c: SnippetCategory) => c,
    );
  }, [search]);

  const snippetsInCategory = useMemo(() => {
    if (!currentCategory || currentCategory === "TikZ") return [];
    return searchFilter(
      getSnippetsByCategory(currentCategory),
      search,
      (s) => `${s.label} ${s.description ?? ""}`,
    );
  }, [currentCategory, search]);

  const tikzRootItems = useMemo(() => {
    if (currentCategory !== "TikZ" || path.length > 1)
      return {
        snippets: [] as ReturnType<typeof getSnippetsByCategory>,
        libraries: [] as typeof tikzLibraries,
      };
    const tikzSnippets = getSnippetsByCategory("TikZ");
    return {
      snippets: searchFilter(
        tikzSnippets,
        search,
        (s) => `${s.label} ${s.description ?? ""}`,
      ),
      libraries: searchFilter(
        tikzLibraries,
        search,
        (l) => `${l.name} ${l.description}`,
      ),
    };
  }, [currentCategory, path.length, search]);

  const libraryExamples = useMemo(() => {
    if (path.length !== 2 || path[0] !== "TikZ" || !path[1]) return [];
    const lib = tikzLibraries.find((l) => l.id === path[1]);
    if (!lib) return [];
    return searchFilter(
      lib.examples,
      search,
      (e) => `${e.name} ${e.description}`,
    );
  }, [path, search]);

  const currentItems = useMemo((): PaletteItem[] => {
    const items: PaletteItem[] = [];
    const iconFor = (c: SnippetCategory) =>
      c === "Document"
        ? "file"
        : c === "Math"
          ? "math"
          : c === "Structure"
            ? "braces"
            : "graph";
    if (isRoot) {
      rootCategories.forEach((cat) => {
        items.push({
          id: `cat-${cat}`,
          label: cat,
          icon: iconFor(cat),
          isFolder: true,
          onSelect: () => setPath([cat]),
        });
      });
      return items;
    }
    if (currentCategory && currentCategory !== "TikZ") {
      snippetsInCategory.forEach((s) => {
        items.push({
          id: `snippet-${s.label}`,
          label: s.label,
          description: s.description,
          icon: "braces",
          isFolder: false,
          onSelect: () => handleInsert(s.template),
        });
      });
      return items;
    }
    if (currentCategory === "TikZ" && path.length === 1) {
      const { snippets, libraries } = tikzRootItems;
      snippets.forEach((s) => {
        items.push({
          id: `tikz-snippet-${s.label}`,
          label: s.label,
          description: s.description,
          icon: "graph",
          isFolder: false,
          onSelect: () => handleInsert(s.template),
          preview: { libraryId: "snippets", exampleId: s.label.toLowerCase().replace(/\W+/g, "-"), source: s.template, name: s.label },
        });
      });
      libraries.forEach((l) => {
        items.push({
          id: `lib-${l.id}`,
          label: l.name,
          description: l.description,
          icon: "graph",
          isFolder: true,
          onSelect: () => setPath(["TikZ", l.id]),
          preview: l.examples[0] ? { libraryId: l.id, exampleId: l.examples[0].id, source: l.examples[0].source, name: l.examples[0].name } : undefined,
        });
      });
      return items;
    }
    if (path.length === 2 && path[0] === "TikZ") {
      libraryExamples.forEach((ex) => {
        items.push({
          id: `ex-${ex.id}`,
          label: ex.name,
          description: ex.description,
          icon: "graph",
          isFolder: false,
          onSelect: () => {
            if (!onInsertTikz) return handleInsert(splitTikzSource(ex.source).body);
            onInsertTikz(ex.source);
            handleOpenChange(false);
          },
          preview: { libraryId: path[1] as string, exampleId: ex.id, source: ex.source, name: ex.name },
        });
      });
    }
    return items;
  }, [
    isRoot,
    currentCategory,
    path,
    rootCategories,
    snippetsInCategory,
    tikzRootItems,
    libraryExamples,
    handleInsert,
    handleOpenChange,
    onInsertTikz,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [path, search]);

  // The highlighted item's figure, a moment after it is highlighted, so skimming the list with the pointer or the arrow keys does not start a render for every row passed over.
  const hasPreviews = currentItems.some((item) => item.preview);
  const highlighted = currentItems[selectedIndex]?.preview ?? null;
  const [preview, setPreview] = useState<PaletteItem["preview"] | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setPreview(highlighted), 140);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    if (el && listRef.current) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (currentItems.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, currentItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        currentItems[selectedIndex]?.onSelect();
        return;
      }
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < currentItems.length) {
          e.preventDefault();
          currentItems[idx].onSelect();
        }
        return;
      }
      if (e.key === "Backspace" && !search) {
        e.preventDefault();
        if (isRoot) {
          handleOpenChange(false);
        } else {
          goBack();
        }
        return;
      }
    },
    [currentItems, selectedIndex, search, isRoot, goBack, handleOpenChange],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {cursorCoords !== undefined || getCursorCoords ? (
        <PopoverAnchor asChild>
          <div
            style={
              anchorCoords
                ? {
                    position: "fixed",
                    left: anchorCoords.left,
                    top: anchorCoords.bottom,
                    width: 1,
                    height: 1,
                    pointerEvents: "none",
                  }
                : {
                    position: "fixed",
                    left: 0,
                    top: 0,
                    width: 0,
                    height: 0,
                    visibility: "hidden" as const,
                  }
            }
          />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            title="Insert snippet or TikZ (Shift+Space)"
          >
            <PlusCircle />
            Insert
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        avoidCollisions={true}
        className={cn("p-0", hasPreviews ? "w-[620px] max-w-[calc(100vw-2rem)]" : "w-[340px]")}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() => {
            const input =
              containerRef.current?.querySelector<HTMLInputElement>("input");
            input?.focus();
          });
        }}
      >
        <div ref={containerRef} tabIndex={-1} className="flex outline-none">
          <div className="flex w-[340px] max-w-full shrink-0 flex-col">
            <div className="flex flex-col gap-1.5 border-b border-line p-2">
              {/* Inside a group: where you are, and the way back. */}
              {!isRoot && (
                <button type="button" onClick={goBack} className="flex h-8 items-center gap-1.5 self-start rounded-[var(--radius)] ps-1 pe-2 type-small font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
                  <ChevronRight aria-hidden className="size-4 rotate-180 rtl:rotate-0" />
                  {path.map((segment, i) => (i === 1 ? (tikzLibraries.find((l) => l.id === segment)?.name ?? segment) : segment)).join(" / ")}
                </button>
              )}
              <Input
                placeholder={isRoot ? "Search what to insert" : "Search this group"}
                aria-label="Search what to insert"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (["ArrowUp", "ArrowDown", "Enter"].includes(e.key) || (e.key >= "1" && e.key <= "9") || (e.key === "Backspace" && !search)) {
                    e.preventDefault();
                    handleKeyDown(e as unknown as React.KeyboardEvent<HTMLDivElement>);
                  }
                }}
              />
            </div>
            <LongScroll scrollRef={listRef} maxHeight="min(360px,60vh)" scrollClassName="scrollbar-modern p-1.5">
              {currentItems.length === 0 ? (
                <p className="px-2.5 py-6 text-center type-base text-muted-foreground">Nothing matches.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {currentItems.map((item, idx) => (
                    <button
                      key={item.id}
                      ref={(el) => {
                        itemRefs.current.set(idx, el);
                      }}
                      type="button"
                      onClick={() => item.onSelect()}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      data-selected={idx === selectedIndex || undefined}
                      className="group/item flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-item)] px-2.5 py-1.5 text-start type-base transition-colors hover:bg-surface-hover/70 data-selected:bg-surface-hover"
                    >
                      {/* The first nine rows answer to their number: the key is shown where the eye starts, as a key. */}
                      <kbd aria-hidden className={cn(kbdClass, "w-5 px-0 tabular-nums", idx >= 9 && "invisible", "group-data-selected/item:border-[color-mix(in_oklch,var(--line),var(--foreground)_30%)] group-data-selected/item:text-foreground")}>
                        {idx + 1}
                      </kbd>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.label}</span>
                        {item.description && <span className="block truncate type-small text-muted-foreground">{item.description}</span>}
                      </span>
                      {/* A group opens its list; anything else is inserted. */}
                      {item.isFolder ? <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" /> : <span className="shrink-0 type-small text-muted-foreground opacity-0 transition-opacity group-data-selected/item:opacity-100">Insert</span>}
                    </button>
                  ))}
                </div>
              )}
            </LongScroll>
            <div className="flex h-9 shrink-0 items-center gap-3 border-t border-line px-3 type-small text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Kbd>1</Kbd>
                <span aria-hidden>to</span>
                <Kbd>9</Kbd> pick
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd> {currentItems[selectedIndex]?.isFolder ? "open" : "insert"}
              </span>
              {!isRoot && (
                <span className="flex items-center gap-1.5">
                  <Kbd>⌫</Kbd> back
                </span>
              )}
            </div>
          </div>
          {hasPreviews && (
            <aside aria-label="Preview" className="flex min-w-0 flex-1 flex-col gap-2 border-s border-line p-3">
              {preview ? (
                <>
                  <TikzThumb key={`${preview.libraryId}/${preview.exampleId}`} libraryId={preview.libraryId} exampleId={preview.exampleId} source={preview.source} name={preview.name} />
                  <p className="truncate type-small text-muted-foreground">{preview.name}</p>
                </>
              ) : (
                <p className="m-auto px-4 text-center type-small text-muted-foreground">Highlight a figure to preview it.</p>
              )}
            </aside>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
