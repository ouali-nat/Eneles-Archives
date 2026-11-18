"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Copy, ExternalLink, Trash2, X } from "@/components/icons";
import { LabelChip } from "@/components/essential/resource-list/LabelChip";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/time";
import { SnipThumb, snipMath } from "./SnipThumb";
import { TexSource } from "@/components/ui/tex-code";

export interface PanelSnip {
  id: string;
  title?: string;
  imageUrl?: string | null;
  latexContent?: string | null;
  status: string;
  tags?: string[];
  fileSize?: number;
  createdAt: string;
  updatedAt: string;
}


/**
 * A snip's details beside the list, for looking through snips quickly: the image, the LaTeX with one press to copy it, how it typesets, and the facts about it. It is not a dialog: the list stays usable, so pressing another snip shows that one here, and the arrow keys step through the list. The snip's own page is one press away.
 */
export function SnipPanel({
  snip,
  position,
  onClose,
  onStep,
  onDelete,
  status,
  labelColors,
}: {
  snip: PanelSnip | null;
  /** "3 of 12", when the snip is in the list on screen. */
  position?: { index: number; total: number };
  onClose: () => void;
  /** Show the snip before (-1) or after (1) this one in the list. */
  onStep: (direction: -1 | 1) => void;
  onDelete: (id: string) => Promise<void>;
  status?: ReactNode;
  labelColors?: Record<string, string>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const snipId = snip?.id;

  // A new snip starts with the delete confirmation closed.
  const [shownId, setShownId] = useState(snipId);
  if (shownId !== snipId) {
    setShownId(snipId);
    setConfirming(false);
  }

  useEffect(() => {
    if (!snipId) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        onStep(1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        onStep(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snipId, onClose, onStep]);

  if (!snip) return null;
  const latex = snip.latexContent?.trim() ?? "";
  const labels = (snip.tags ?? []).filter((tag) => tag !== "archived");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(latex);
      toast.success("LaTeX copied");
    } catch {
      toast.error("The browser did not allow copying");
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete(snip.id);
      toast.success("Snip deleted");
      onClose();
    } catch {
      toast.error("The snip could not be deleted");
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <aside aria-label={`Snip: ${snip.title || "Untitled snip"}`} className="fixed inset-y-0 end-0 z-40 flex w-full max-w-[28rem] animate-in flex-col border-s border-line bg-panel shadow-modal duration-200 slide-in-from-right-8 fade-in">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line ps-4 pe-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate type-base font-semibold">{snip.title || "Untitled snip"}</h2>
          {position && (
            <p className="type-small text-muted-foreground tabular-nums">
              {position.index + 1} of {position.total}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Previous snip" title="Previous snip (↑)" disabled={!position || position.index === 0} onClick={() => onStep(-1)}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next snip" title="Next snip (↓)" disabled={!position || position.index >= position.total - 1} onClick={() => onStep(1)}>
          <ChevronDown />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <SnipThumb imageUrl={snip.imageUrl} latex={latex} title={snip.title} fit="contain" className="aspect-[4/3] w-full rounded-[var(--radius-card)]" />

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="type-base font-medium">LaTeX</h3>
            {status}
          </div>
          {latex ? (
            <pre className="max-h-56 overflow-auto rounded-[var(--radius)] border border-line bg-background p-3 font-mono type-small leading-relaxed whitespace-pre-wrap">
              <TexSource source={latex} />
            </pre>
          ) : (
            <p className="rounded-[var(--radius)] border border-dashed border-line p-3 type-small text-muted-foreground">{snip.status === "error" ? "The conversion failed. Open the snip's page to try again." : "The LaTeX appears here when the conversion finishes."}</p>
          )}
        </section>

        {/* With an image above, the typeset LaTeX is the check that the conversion matches it. Without one, the tile above already shows it. */}
        {snip.imageUrl && snipMath(latex) && (
          <section className="flex flex-col gap-2">
            <h3 className="type-base font-medium">Typeset</h3>
            <SnipThumb latex={latex} title={snip.title} className="h-28 w-full rounded-[var(--radius)]" />
          </section>
        )}

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 type-small">
          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-end"><RelativeTime value={snip.createdAt} /></dd>
          <dt className="text-muted-foreground">Updated</dt>
          <dd className="text-end"><RelativeTime value={snip.updatedAt} /></dd>
          {!!snip.fileSize && (
            <>
              <dt className="text-muted-foreground">Image size</dt>
              <dd className="text-end">{formatFileSize(snip.fileSize)}</dd>
            </>
          )}
          {labels.length > 0 && (
            <>
              <dt className="text-muted-foreground">Labels</dt>
              <dd className="flex flex-wrap justify-end gap-1.5">
                {labels.map((label) => (
                  <LabelChip key={label} label={label} color={labelColors?.[label]} />
                ))}
              </dd>
            </>
          )}
        </dl>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line p-3">
        <Button onClick={() => void copy()} disabled={!latex}>
          <Copy />
          Copy LaTeX
        </Button>
        <Button asChild variant="outline">
          <Link href={`/snips/${snip.id}`}>
            <ExternalLink />
            Open page
          </Link>
        </Button>
        <span className="ms-auto flex items-center gap-2">
          {confirming ? (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
                Keep
              </Button>
              <Button variant="destructive" onClick={() => void remove()} disabled={deleting}>
                Delete
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="icon" aria-label="Delete snip" title="Delete snip" onClick={() => setConfirming(true)}>
              <Trash2 />
            </Button>
          )}
        </span>
      </footer>
    </aside>
  );
}
