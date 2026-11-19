"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitGraph, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TikzThumb } from "@/components/essential/library/TikzThumb";
import { tikzCategories, tikzLibraries } from "@/lib/tikz/libraries";
import { cn } from "@/lib/utils";

/** Every library example, flattened with the package it belongs to, in catalog order. */
const TEMPLATES = tikzLibraries.flatMap((lib) =>
  lib.examples.map((ex) => ({
    key: `${lib.id}/${ex.id}`,
    libraryId: lib.id,
    library: lib.name,
    custom: lib.custom === true,
    category: lib.category,
    example: ex,
    haystack: [ex.name, ex.description, lib.name, lib.category, ...ex.tags, ...lib.tags].join(" ").toLowerCase(),
  })),
);
type Template = (typeof TEMPLATES)[number];

const CATEGORIES = tikzCategories.map((category) => ({
  category,
  count: category === "All" ? TEMPLATES.length : TEMPLATES.filter((t) => t.category === category).length,
}));

/** Columns in the grid, for moving up and down with the arrow keys. */
const COLUMNS = 3;

/**
 * The formatting bar's "Insert a TikZ diagram" button: a searchable gallery of the library's examples, by category, each with its rendered preview. Choosing one hands its source to `onInsert`, which puts the figure at the cursor and what it needs into the preamble.
 *
 * Keyboard: type to search, Down moves into the grid, the arrow keys move within it, Enter inserts, Up from the first row goes back to the search field, and Escape closes.
 */
export function TikzTemplatePicker({ onInsert }: { onInsert: (source: string, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return TEMPLATES.filter((t) => (category === "All" || t.category === category) && words.every((w) => t.haystack.includes(w)));
  }, [query, category]);

  // A new search or category starts at the first result.
  const [seen, setSeen] = useState({ query, category });
  if (seen.query !== query || seen.category !== category) {
    setSeen({ query, category });
    setActive(0);
  }

  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = useCallback(
    (template: Template | undefined) => {
      if (!template) return;
      onInsert(template.example.source, template.example.name);
      setOpen(false);
    },
    [onInsert],
  );

  const onGridKey = (e: React.KeyboardEvent) => {
    const last = results.length - 1;
    const move = (to: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(last, to)));
    };
    if (e.key === "ArrowRight") move(active + 1);
    else if (e.key === "ArrowLeft") move(active - 1);
    else if (e.key === "ArrowDown") move(active + COLUMNS);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(last);
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (active < COLUMNS) input.current?.focus();
      else setActive(active - COLUMNS);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Typing anywhere in the picker searches.
      input.current?.focus();
    }
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      grid.current?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  };

  const activeTemplate = results[active];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" title="Insert a TikZ diagram" aria-label="Insert a TikZ diagram">
          <GitGraph className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={16}
        className="flex h-[min(560px,calc(100vh-8rem))] w-[min(780px,calc(100vw-2rem))] flex-col p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-line p-2">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search diagrams: flowchart, circuit, neural network…"
              aria-label="Search TikZ diagrams"
              aria-controls="tikz-template-grid"
              className="ps-9"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav aria-label="Categories" className="w-48 shrink-0 overflow-y-auto border-e border-line p-1.5">
            {CATEGORIES.map(({ category: c, count }) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={cn(
                  "flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-item)] px-3 text-start type-base transition-colors",
                  category === c ? "bg-surface-hover text-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <span className="truncate">{c === "All" ? "All diagrams" : c}</span>
                <span className="type-small tabular-nums text-muted-foreground">{count}</span>
              </button>
            ))}
          </nav>

          <div
            id="tikz-template-grid"
            ref={grid}
            role="listbox"
            tabIndex={0}
            aria-label="Diagrams"
            aria-activedescendant={activeTemplate ? `tikz-template-${active}` : undefined}
            onKeyDown={onGridKey}
            className="group/grid min-w-0 flex-1 overflow-y-auto p-3 outline-none"
          >
            {results.length === 0 ? (
              <p className="px-2 py-10 text-center type-base text-muted-foreground">No diagrams match “{query}”.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {results.map((t, i) => (
                  <div
                    key={t.key}
                    id={`tikz-template-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onClick={() => choose(t)}
                    onMouseMove={() => i !== active && setActive(i)}
                    className={cn(
                      "flex cursor-pointer flex-col gap-2 rounded-[var(--radius-inset)] border p-2 transition-colors",
                      i === active ? "border-accent bg-surface-hover" : "border-transparent hover:bg-surface-hover",
                    )}
                  >
                    <TikzThumb libraryId={t.libraryId} exampleId={t.example.id} source={t.example.source} name={t.example.name} />
                    <div className="min-w-0 px-1 pb-0.5">
                      <p className="truncate type-base text-foreground" title={t.example.name}>{t.example.name}</p>
                      <p className={cn("truncate type-small text-muted-foreground", !t.custom && "font-mono")}>{t.library}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-line px-3 type-small text-muted-foreground">
          <span className="truncate">{activeTemplate ? activeTemplate.example.description : `${results.length} diagrams`}</span>
          <span className="shrink-0">Arrow keys to move, Enter to insert</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
