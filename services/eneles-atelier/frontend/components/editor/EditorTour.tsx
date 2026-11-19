"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tour, type TourStep } from "@/components/ui/tour";

/**
 * The editor's first-run tutorial: eight short steps on where things are. It opens by itself the first time someone opens a project in this browser, can be skipped at any step, and can be opened again from the View menu.
 */

const SEEN_KEY = "texer-editor-tour:v1";

const tab = (name: string) => () => [...document.querySelectorAll<HTMLElement>(".dv-tab")].find((el) => el.textContent?.trim().startsWith(name));
const button = (text: string) => () => [...document.querySelectorAll<HTMLElement>("button")].find((el) => el.textContent?.trim() === text || el.getAttribute("aria-label") === text);

// In reading order across the screen: the toolbar's left, the sidebar, the editor in the middle, the PDF and the group of Axya, Review, and Chat under it on the right, then the toolbar's right. The spotlight never doubles back.
const STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to the editor",
    content: (
      <>
        A one-minute look at where things are. You can skip it now and open it again later from <strong>View → Show the tutorial</strong>.
      </>
    ),
  },
  {
    id: "layout",
    target: button("View"),
    side: "bottom",
    title: "Make the layout yours",
    content: (
      <>
        Drag any tab to move its panel, drop it on another to stack them, and drag the dividers to resize. <strong>View</strong> has ready-made layouts and brings back any panel you close.
      </>
    ),
  },
  {
    id: "files",
    target: "[data-file-tree]",
    side: "right",
    title: "Your files",
    content: (
      <>
        Every file in the project. Right-click for new files and folders, or drop images and <code>.bib</code> files here to upload them. The file marked <strong>main</strong> is the one that gets compiled.
      </>
    ),
  },
  {
    id: "source",
    target: ".cm-editor",
    side: "left",
    title: "Write here",
    content: (
      <>
        The LaTeX source, saved as you type. Press <kbd>Shift</kbd> + <kbd>Space</kbd> to insert equations, tables, figures, and diagrams from a list, or switch to <strong>Visual</strong> above to see headings and math drawn in place.
      </>
    ),
  },
  {
    id: "pdf",
    target: "[data-tour='pdf']",
    side: "left",
    title: "Compile and read",
    content: (
      <>
        <strong>Recompile</strong>, or <kbd>Ctrl</kbd> + <kbd>Enter</kbd>, builds the PDF. Double-click anywhere in the PDF to jump to the source that made it, and <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd> shows your cursor&apos;s place in the PDF.
      </>
    ),
  },
  {
    id: "review",
    target: tab("Review"),
    side: "left",
    title: "Review and chat",
    content: (
      <>
        Select text and two buttons appear beside it: <strong>Comment</strong> starts a thread here, and <strong>Suggest</strong> proposes a rewrite the others accept or reject. <strong>Chat</strong> is the project&apos;s own conversation, and both share this group with Axya.
      </>
    ),
  },
  {
    id: "assistant",
    // Its tab when it is a panel; the toolbar button when it floats over the editor.
    target: () => tab("Axya")() ?? button("Axya")(),
    side: "left",
    title: "Ask Axya",
    content: (
      <>
        The assistant reads your project and proposes edits as changes you review file by file. Type <kbd>/</kbd> in its box for commands such as fixing compile errors.
      </>
    ),
  },
  {
    id: "share",
    target: button("Share"),
    side: "bottom",
    title: "Work together",
    content: (
      <>
        Invite people by email or share a link. Everyone edits the same text at once, and you see each other&apos;s cursors. That is the tour: happy writing.
      </>
    ),
  },
];

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "done";
  } catch {
    // Without storage the tour would open on every visit; treat it as seen.
    return true;
  }
}

/** Whether the tutorial is showing, and how to open and close it. It opens once by itself, a moment after the editor has laid itself out. */
export function useEditorTour(ready: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready || seen()) return;
    const timer = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(timer);
  }, [ready]);
  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "done");
    } catch {
      // Nothing to remember it in.
    }
  }, []);
  const show = useCallback(() => setOpen(true), []);
  return { open, close, show };
}

/** `without` leaves steps out by id, for an editor that lacks what they point at (the desktop app's local projects have no Review). */
export function EditorTour({ open, onClose, without }: { open: boolean; onClose: () => void; without?: string[] }) {
  const steps = useMemo(() => (without?.length ? STEPS.filter((s) => !without.includes(s.id)) : STEPS), [without]);
  return <Tour steps={steps} open={open} onClose={onClose} finishLabel="Start writing" />;
}
