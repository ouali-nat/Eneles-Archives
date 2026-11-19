"use client";

import { useState, useCallback, useRef } from "react";
import { projectsAPI } from "@/lib/api";
import { loadSyncTex } from "@/lib/synctex";
import { rememberCompiledSources } from "@/lib/synctex-bridge";

/** PDF source: either a URL string or raw binary data for react-pdf */
export type PdfSource = string | { data: Uint8Array };

/**
 * Key of the compiled PDF in the builds bucket (e.g. "builds/123/1700000000_output.pdf").
 * Returned by the API after a successful compile; used by the Download button
 * to fetch the archived PDF through the authenticated /projects/:uid/pdf proxy
 * rather than relying on the in-memory Uint8Array (which pdf.js detaches).
 */
export type BuildKey = string | null;

/**
 * Parse a LaTeX log string and extract individual error/warning messages.
 * Each error in a TeX log typically starts with "! " on its own line.
 * Warnings typically start with "LaTeX Warning:" or "Package <name> Warning:".
 */
function parseLatexLog(log: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = log.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // TeX errors start with "! "
    if (line.startsWith("! ")) {
      // Collect the error message and any continuation lines
      let msg = line.slice(2).trim();
      // Look ahead for the "l.<number>" line reference
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const next = lines[j];
        if (/^l\.\d+/.test(next)) {
          msg += ` (${next.trim()})`;
          break;
        }
      }
      errors.push(msg);
    }

    // LaTeX warnings
    if (
      /^(LaTeX|Package|Class)\s+(\w+\s+)?Warning:/i.test(line) ||
      /^Overfull\s+\\[hv]box/.test(line) ||
      /^Underfull\s+\\[hv]box/.test(line)
    ) {
      warnings.push(line.trim());
    }
  }

  return { errors, warnings };
}

export function useCompile({
  projectId,
  isAuthenticated,
  onLogAction,
  onAutoOpenLogAction,
}: {
  projectId: string;
  isAuthenticated: boolean;
  onLogAction: (
    type: "info" | "error" | "warning",
    message: string,
    line?: number,
  ) => void;
  /** Called when compilation produces errors; lets the parent auto-open the log panel */
  onAutoOpenLogAction?: () => void;
}) {
  const [isCompiling, setIsCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<PdfSource | null>(null);
  const [buildKey, setBuildKey] = useState<BuildKey>(null);
  /** base64 <main>.synctex.gz from the last successful compile, for jumping between the PDF and the source */
  const [synctexData, setSynctexData] = useState<string | null>(null);
  /** The text of each file as that compile read it, by project path */
  const [compiledSources, setCompiledSources] = useState<Record<string, string> | null>(null);
  const [compileDuration, setCompileDuration] = useState<number | null>(null);
  const [compileErrors, setCompileErrors] = useState<string[]>([]);
  const compileAbortRef = useRef<AbortController | null>(null);

  const handleCompile = useCallback(async () => {
    if (!isAuthenticated) return;
    if (isCompiling) {
      compileAbortRef.current?.abort();
      setIsCompiling(false);
      return;
    }

    setIsCompiling(true);
    setCompileErrors([]);
    onLogAction("info", "Compiling...");
    const start = Date.now();
    const controller = new AbortController();
    compileAbortRef.current = controller;

    try {
      const result = await projectsAPI.compile(projectId);
      const elapsed = Date.now() - start;
      setCompileDuration(elapsed);

      // ── Surface the full log ──
      // Parse the raw TeX log for structured errors/warnings even if
      // the compiler service didn't extract them into result.errors.
      let logErrors: string[] = [];
      let logWarnings: string[] = [];

      if (result.log) {
        const parsed = parseLatexLog(result.log);
        logErrors = parsed.errors;
        logWarnings = parsed.warnings;
      }
      // Bibliography and index warnings come first: a missing entry is
      // usually the one worth fixing.
      logWarnings = [...(result.warnings || []), ...logWarnings];

      // Merge compiler-extracted errors with log-parsed errors (deduplicated)
      const allErrors: string[] = [
        ...(result.errors || []),
        ...logErrors.filter(
          (e) =>
            !(result.errors || []).some(
              (re) => re.includes(e) || e.includes(re),
            ),
        ),
      ];

      // ── Decide outcome ──
      if (result.success && result.pdf) {
        // Successful compilation with PDF output
        const binary = atob(result.pdf);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        setPdfUrl({ data: bytes });
        // Record the builds-bucket key (if the API archived this build).
        // This is the authoritative snapshot the Download button should use,
        // because pdf.js will detach the in-memory Uint8Array once it renders.
        setBuildKey(result.buildKey ?? null);
        // Capture the SyncTeX index for PDF->source reverse sync (may be null
        // for older builds or engines that didn't emit it).
        setSynctexData(result.synctex ?? null);
        // SyncTeX counts lines of the text that was compiled, which the preview compares with the text in the editor.
        setCompiledSources(result.sources ?? null);
        if (result.synctex) {
          rememberCompiledSources(result.synctex, result.sources);
          // Parse now, in slices that leave typing alone, so the first jump after a compile is instant.
          void loadSyncTex(result.synctex);
        }
        setCompileErrors([]);

        const durationStr = `${(elapsed / 1000).toFixed(1)}s`;

        if (allErrors.length > 0) {
          // Compiled with errors (LaTeX produced a PDF despite errors)
          onLogAction(
            "warning",
            `Compilation completed with errors in ${durationStr}`,
          );
          for (const err of allErrors) {
            onLogAction("error", err);
          }
          onAutoOpenLogAction?.();
        } else if (logWarnings.length > 0) {
          onLogAction(
            "info",
            `Compilation successful in ${durationStr} (${logWarnings.length} warning${logWarnings.length !== 1 ? "s" : ""})`,
          );
          for (const w of logWarnings.slice(0, 10)) {
            onLogAction("warning", w);
          }
        } else {
          onLogAction("info", `Compilation successful in ${durationStr}.`);
        }
      } else if (result.success && !result.pdf) {
        // Compiler says success but no PDF: unusual, treat as failure
        setPdfUrl(null);
        setBuildKey(null);
        setCompileErrors(
          allErrors.length > 0
            ? allErrors
            : ["Compilation returned no PDF output."],
        );
        onLogAction("error", "Compilation returned no PDF output.");
        if (allErrors.length > 0) {
          for (const err of allErrors) {
            onLogAction("error", err);
          }
        }
        if (result.log) {
          onLogAction("info", result.log);
        }
        onAutoOpenLogAction?.();
      } else {
        // ── Compilation failed ──
        setPdfUrl(null);
        setBuildKey(null);

        const displayErrors =
          allErrors.length > 0
            ? allErrors
            : ["Compilation failed. Check the log for details."];

        setCompileErrors(displayErrors);

        onLogAction(
          "error",
          `Compilation failed in ${(elapsed / 1000).toFixed(1)}s.`,
        );
        for (const err of displayErrors) {
          onLogAction("error", err);
        }

        // If we have warnings, show a few
        for (const w of logWarnings.slice(0, 5)) {
          onLogAction("warning", w);
        }

        // Always dump the raw log on failure so the user can debug
        if (result.log) {
          onLogAction("info", result.log);
        }

        onAutoOpenLogAction?.();
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      const msg = err.message || "Compilation failed";
      onLogAction("error", msg);
      setCompileErrors([msg]);
      onAutoOpenLogAction?.();
      setIsCompiling(false);
    } finally {
      setIsCompiling(false);
    }
  }, [isAuthenticated, projectId, isCompiling, onLogAction, onAutoOpenLogAction]);

  return {
    isCompiling,
    pdfUrl,
    buildKey,
    synctexData,
    compiledSources,
    compileDuration,
    compileErrors,
    handleCompile,
    setPdfUrl,
    setBuildKey,
  };
}
