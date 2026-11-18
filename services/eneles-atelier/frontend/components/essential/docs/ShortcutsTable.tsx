"use client";

import { cn } from "@/lib/utils";

interface Shortcut {
  keys: string;
  keysMac?: string;
  description: string;
}

interface ShortcutsTableProps {
  shortcuts: Shortcut[];
  className?: string;
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center rounded border bg-surface px-1.5 py-0.5 text-[12px] font-mono font-medium text-foreground shadow-[0_1px_0_1px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_1px_rgba(255,255,255,0.04)]">
      {children}
    </kbd>
  );
}

function KeyCombo({ combo }: { combo: string }) {
  const parts = combo.split(/\s*\+\s*/);
  return (
    <span className="inline-flex items-center gap-1">
      {parts.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/40 text-xs">+</span>}
          <Kbd>{part.trim()}</Kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutsTable({ shortcuts, className }: ShortcutsTableProps) {
  return (
    <div className={cn("my-6 rounded-lg border overflow-hidden", className)}>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b bg-surface/30">
            <th className="text-start font-semibold px-4 py-2.5 text-foreground text-[13px]">
              Shortcut
            </th>
            <th className="text-start font-semibold px-4 py-2.5 text-foreground text-[13px]">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {shortcuts.map((shortcut, i) => (
            <tr
              key={i}
              className="border-b last:border-0 transition-colors hover:bg-surface/20"
            >
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <KeyCombo combo={shortcut.keys} />
                  {shortcut.keysMac && (
                    <span className="hidden @min-[40rem]:inline-flex items-center gap-1 text-muted-foreground/40">
                      <span className="text-xs">/</span>
                      <KeyCombo combo={shortcut.keysMac} />
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {shortcut.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
