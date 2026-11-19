"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KEYBOARD_SHORTCUTS } from "@/lib/editor/commands";
import { useMemo } from "react";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const categoriesOrder = [
  "General",
  "File",
  "Editing",
  "Formatting",
  "Search",
  "Navigation",
];

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const grouped = useMemo(() => {
    const map: Record<string, typeof KEYBOARD_SHORTCUTS> = {};
    for (const s of KEYBOARD_SHORTCUTS) {
      if (!map[s.category]) map[s.category] = [];
      map[s.category].push(s);
    }
    const ordered = categoriesOrder.filter((c) => map[c]?.length);
    const rest = Object.keys(map).filter((c) => !categoriesOrder.includes(c));
    return [...ordered, ...rest].map((cat) => ({
      category: cat,
      shortcuts: map[cat],
    }));
  }, []);

  const mid = Math.ceil(grouped.length / 2);
  const leftCol = grouped.slice(0, mid);
  const rightCol = grouped.slice(mid);

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  const CategoryBlock = ({
    category,
    shortcuts,
  }: {
    category: string;
    shortcuts: typeof KEYBOARD_SHORTCUTS;
  }) => (
    <div key={category}>
      <h3 className="mb-2 type-small font-medium text-muted-foreground">
        {category}
      </h3>
      <div className="space-y-1">
        {shortcuts.map((s) => (
          <div
            key={s.keys + s.description}
            className="flex items-center justify-between py-1 px-3 rounded-md hover:bg-surface/50"
          >
            <span className="text-sm text-foreground">{s.description}</span>
            <kbd className="shrink-0 inline-flex items-center gap-0.5 px-2 py-1 text-xs font-mono bg-surface rounded border border-line/60 shadow-sm">
              {isMac && s.keysMac ? s.keysMac : s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-6xl overflow-visible flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg">Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-20 gap-y-0 py-2">
          <div className="space-y-6">
            {leftCol.map(({ category, shortcuts }) => (
              <CategoryBlock
                key={category}
                category={category}
                shortcuts={shortcuts}
              />
            ))}
          </div>
          <div className="space-y-6">
            {rightCol.map(({ category, shortcuts }) => (
              <CategoryBlock
                key={category}
                category={category}
                shortcuts={shortcuts}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
