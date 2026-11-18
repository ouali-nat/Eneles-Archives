"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The name field a row turns into, for a new file or folder and for a rename. Enter keeps the name, Escape gives it up, and leaving the field keeps a name that was typed. It selects the part before the extension, so typing replaces the name and leaves ".tex" alone.
 */
export function NameInput({ initial, isFolder, label, placeholder, onSubmit, onCancel, onValueChange }: { initial: string; isFolder: boolean; label: string; placeholder?: string; onSubmit: (name: string) => void; onCancel: () => void; /** Each keystroke, for a row that draws the icon of the name being typed. */ onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const mountedAt = useRef(0);
  // Enter and Escape settle the field; the blur that follows them must not settle it a second time.
  const settled = useRef(false);

  const focusName = (el: HTMLInputElement) => {
    el.focus({ preventScroll: true });
    const dot = el.value.lastIndexOf(".");
    if (!isFolder && dot > 0) el.setSelectionRange(0, dot);
    else if (!isFolder && dot === 0) el.setSelectionRange(0, 0);
    else el.select();
  };

  useEffect(() => {
    mountedAt.current = performance.now();
    const frame = requestAnimationFrame(() => input.current && focusName(input.current));
    return () => cancelAnimationFrame(frame);
    // On mount only: doing it again would move the cursor while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (keep: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const name = value.trim();
    if (keep && name && name !== "." && name !== ".tex") onSubmit(name);
    else onCancel();
  };

  return (
    <input
      ref={input}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className="field h-7 min-w-0 flex-1 px-2 type-base outline-none"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onValueChange?.(e.target.value);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // The tree's own keys (Delete, the arrows, F2) are not for a field being typed in.
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={(e) => {
        // Started from a right-click menu, the field appears while the menu is still closing, and the menu then hands the focus back to the row it was opened on. That is not the person leaving the field: take the focus back.
        if (performance.now() - mountedAt.current < 600) {
          const el = e.currentTarget;
          requestAnimationFrame(() => el.isConnected && !settled.current && focusName(el));
          return;
        }
        finish(true);
      }}
    />
  );
}
