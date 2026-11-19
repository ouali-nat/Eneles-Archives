import type { RefObject } from "react";
import type { CommentTarget, LatexEditorHandle } from "@/components/editor/LatexEditor";
import { DEFAULT_COMMENT_HUE, type CommentHue } from "@/lib/review/hues";

/** A comment or a suggested replacement being written: the passage, its color, and whether it is written in the review panel or in the popover over the text (a suggestion is always written in the popover). */
export interface CommentDraft {
  kind: "comment" | "suggest";
  target: CommentTarget;
  hue: CommentHue;
  where: "panel" | "popover";
}

export interface ReviewState {
  draft: CommentDraft | null;
  /** The thread shown in the popover over the text. */
  popover: number | null;
  /** The focused editor has a selection, which the "Comment" button sits beside. */
  selection: boolean;
}

/**
 * What the review panel and the comment popover share: the comment being written and the thread open over the text. The editor screen makes one, hands it to both, and routes the editor's comment events to it. While a comment is being written its passage is highlighted in the editor in the chosen hue.
 */
export class ReviewStore {
  private state: ReviewState = { draft: null, popover: null, selection: false };
  private listeners = new Set<() => void>();

  constructor(private readonly editor: RefObject<LatexEditorHandle | null>) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;

  private set(next: Partial<ReviewState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  /** Starts a comment on the editor's selection; false when nothing is selected. */
  compose(where: "panel" | "popover", kind: "comment" | "suggest" = "comment"): boolean {
    const target = this.editor.current?.getCommentTarget() ?? null;
    if (!target) return false;
    const hue = this.state.draft?.hue ?? DEFAULT_COMMENT_HUE;
    this.editor.current?.setDraftComment({ from: target.from, to: target.to, hue });
    this.set({ draft: { kind, target, hue, where: kind === "suggest" ? "popover" : where }, popover: null });
    return true;
  }

  setHue(hue: CommentHue) {
    const draft = this.state.draft;
    if (!draft) return;
    this.editor.current?.setDraftComment({ from: draft.target.from, to: draft.target.to, hue });
    this.set({ draft: { ...draft, hue } });
  }

  /** Gives keyboard focus back to the editor, where the person was writing before they started a comment. */
  focusEditor() {
    this.editor.current?.focus();
  }

  endDraft() {
    if (!this.state.draft) return;
    this.editor.current?.setDraftComment(null);
    this.set({ draft: null });
  }

  openThread(id: number) {
    if (this.state.draft) this.editor.current?.setDraftComment(null);
    this.set({ popover: id, draft: null });
  }

  closePopover() {
    if (this.state.draft?.where === "popover") this.editor.current?.setDraftComment(null);
    this.set({ popover: null, draft: this.state.draft?.where === "popover" ? null : this.state.draft });
  }

  /** Drops everything (another file was opened). */
  reset() {
    if (this.state.draft) this.editor.current?.setDraftComment(null);
    if (this.state.draft || this.state.popover !== null) this.set({ draft: null, popover: null });
  }

  private selectionFrame = 0;
  /** Read after the editor has drawn the change: its layout cannot be read while it updates. */
  selectionChanged() {
    if (this.selectionFrame) return;
    this.selectionFrame = requestAnimationFrame(() => {
      this.selectionFrame = 0;
      const selection = !!this.editor.current?.commentGeometry("selection");
      if (selection !== this.state.selection) this.set({ selection });
    });
  }
}
