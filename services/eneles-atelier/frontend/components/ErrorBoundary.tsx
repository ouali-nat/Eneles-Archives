"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "@/components/icons";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /**
   * Shown in the fallback so the user knows which part of the screen died,
   * e.g. "PDF preview". The rest of the editor keeps working.
   */
  label: string;
  /**
   * Bumping any value in here remounts the subtree. Pass the active file id,
   * project id, or similar, so switching away from whatever triggered the
   * crash clears it instead of leaving the panel dead until a full reload.
   */
  resetKeys?: unknown[];
  /** Replaces the default fallback entirely when you need something custom. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors in one region of the editor.
 *
 * `app/error.tsx` only catches errors at the route level, which means a throw
 * inside CodeMirror, pdf.js, the TikZ canvas, or the AI chat takes down the
 * whole editor and drops the user on a full-page error screen, with whatever
 * they were writing still only in the crashed component. Scoping the boundary
 * to each panel keeps the surrounding editor alive, so their work stays on
 * screen and reachable.
 *
 * React has no hook equivalent for this; a class component is the only way.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}] crashed:`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: Props) {
    if (!this.state.error) return;

    const a = prev.resetKeys;
    const b = this.props.resetKeys;
    if (!a || !b) return;

    if (a.length !== b.length || a.some((key, i) => !Object.is(key, b[i]))) {
      this.reset();
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="h-6 w-6 text-hue-amber" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium">{this.props.label} stopped working</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            The rest of the editor is unaffected and your work is safe.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={this.reset} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Reload this panel
        </Button>
        {process.env.NODE_ENV === "development" && (
          <pre className="mt-2 max-h-32 max-w-full overflow-auto rounded bg-surface p-2 text-start text-[10px] leading-relaxed text-muted-foreground">
            {error.stack ?? error.message}
          </pre>
        )}
      </div>
    );
  }
}
