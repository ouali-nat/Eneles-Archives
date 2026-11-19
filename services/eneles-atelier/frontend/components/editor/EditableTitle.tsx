"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A title you rename in place: it reads as text, shows a quiet plate on hover so it is clearly pressable, and becomes a field of the same size when pressed. Enter or leaving the field commits; Escape restores. After Enter or Escape focus returns to the title, so a keyboard user keeps their place. When `disabled`, it is plain text.
 */
export function EditableTitle({ value, onChange, label, disabled = false, className }: { value: string; onChange: (value: string) => void; /** Accessible name of the field while editing. */ label: string; disabled?: boolean; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Set once the edit has ended by Enter or Escape, so the blur that follows the field's removal never commits again.
  const settled = useRef(false);
  const refocus = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  const finish = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const next = draft.trim();
    if (commit && next && next !== value) onChange(next);
  };

  if (disabled) return <span className={cn("truncate px-2 type-base font-semibold", className)}>{value}</span>;

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={label}
        value={draft}
        size={Math.max(12, draft.length + 2)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            refocus.current = true;
            finish(e.key === "Enter");
          }
        }}
        className={cn("field h-[var(--control-height)] max-w-full min-w-0 px-2.5 text-center type-base font-semibold text-foreground outline-none", className)}
      />
    );
  }

  return (
    <button
      ref={button}
      type="button"
      title="Rename"
      onClick={() => {
        settled.current = false;
        setDraft(value);
        setEditing(true);
      }}
      className={cn("h-[var(--control-height)] max-w-full min-w-0 truncate rounded-[var(--radius)] px-2.5 type-base font-semibold transition-colors hover:bg-surface-hover", className)}
    >
      {value}
    </button>
  );
}
