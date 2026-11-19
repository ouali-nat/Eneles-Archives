/**
 * useCompositor: the single insertion middleman for LaTeX snippets.
 *
 * A "compositor" in traditional typesetting is the craftsman who sets type
 * correctly before it goes to print. Here it is the one place autoIndent
 * logic lives. Every insertion source (toolbar, palette, image drop, macros,
 * speech transcripts, TikZ) calls the returned `compose` function and the
 * compositor decides whether to apply indentation analysis.
 *
 * Design guarantees:
 *  - `compose` has a STABLE identity: it never changes across renders.
 *    Every useCallback that calls it can omit it from deps safely.
 *  - autoIndent is read via a ref, so it always reflects the current setting
 *    without requiring the callback to be recreated.
 *  - `forceRaw=true` bypasses indentation for plain-prose sources (e.g. speech
 *    transcripts) even when autoIndent is enabled.
 */

"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import type { LatexEditorHandle } from "@/components/editor/LatexEditor";

interface UseCompositorOptions {
    /** Ref to the editor imperative handle */
    editorRef: React.RefObject<LatexEditorHandle | null>;
    /** Whether to apply smart LaTeX indentation analysis before inserting */
    autoIndent: boolean;
}

/**
 * Returns a stable `compose(text, forceRaw?)` function.
 *
 * @param text      The LaTeX content to insert at the current cursor position.
 * @param forceRaw  When true, indentation is never applied regardless of the
 *                  autoIndent setting. Use for plain-prose sources.
 */
export type ComposeFunction = (text: string, forceRaw?: boolean) => void;

export function useCompositor({ editorRef, autoIndent }: UseCompositorOptions): ComposeFunction {
    // Mutable ref: always holds the latest autoIndent value without requiring
    // the compose callback to be recreated.
    const autoIndentRef = useRef(autoIndent);
    // Updated as each render commits, so every event handler and passive effect that calls compose sees the committed setting.
    useLayoutEffect(() => {
        autoIndentRef.current = autoIndent;
    });

    // editorRef is stable (created once by useRef in the parent).
    // autoIndentRef is stable (created once here).
    // Therefore compose itself is stable: its identity never changes.
    const compose = useCallback<ComposeFunction>(
        (text, forceRaw = false) => {
            const editor = editorRef.current;
            if (!editor) return;

            const shouldIndent = !forceRaw && autoIndentRef.current;

            // Only multi-line blocks benefit from indentation; single-token
            // insertions (bold, italic, inline math) should never be re-indented.
            const applyIndent = shouldIndent && text.includes("\n");

            editor.insertAtCursor(text, applyIndent);
        },
        [editorRef]           // editorRef is stable → compose is stable → ✓
    );

    return compose;
}
