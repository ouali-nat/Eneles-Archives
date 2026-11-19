"use client";

import { AlertCircle, CheckCircle2, XCircle, Copy, Trash2 } from "@/components/icons";
import { PanelBar } from "@/components/editor/SidebarSection";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LogEntry {
  type: "info" | "warning" | "error" | "success";
  message: string;
  line?: number;
  timestamp?: Date;
}

interface ErrorLogProps {
  logs: LogEntry[];
  onClear: () => void;
}

/** The Logs panel: what the last compiles reported, with the count of errors and warnings in its bar. */
export function ErrorLog({ logs, onClear }: ErrorLogProps) {
  const errorCount = logs.filter((l) => l.type === "error").length;
  const warningCount = logs.filter((l) => l.type === "warning").length;

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.type.toUpperCase()}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PanelBar
        actions={
          <>
            <Button variant="ghost" size="icon-sm" onClick={handleCopyLogs} disabled={logs.length === 0} title="Copy logs" aria-label="Copy logs">
              <Copy className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClear} disabled={logs.length === 0} title="Clear logs" aria-label="Clear logs">
              <Trash2 className="size-4" />
            </Button>
          </>
        }
      >
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-danger">
            <XCircle aria-hidden className="size-4" />
            {errorCount} {errorCount === 1 ? "error" : "errors"}
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1 text-warning">
            <AlertCircle aria-hidden className="size-4" />
            {warningCount} {warningCount === 1 ? "warning" : "warnings"}
          </span>
        )}
        {errorCount === 0 && warningCount === 0 && logs.length > 0 && (
          <span className="flex items-center gap-1 text-success">
            <CheckCircle2 aria-hidden className="size-4" />
            OK
          </span>
        )}
      </PanelBar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-0.5 p-2 font-mono type-small">
          {logs.length === 0 ? (
            <p className="px-1 py-0.5 font-sans type-base text-muted-foreground">Nothing yet. What a compile reports shows here.</p>
          ) : (
            logs.map((log, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-[var(--radius-inset)] px-1.5 py-1",
                  log.type === "error" && "text-danger bg-danger/5",
                  log.type === "warning" && "text-warning bg-warning/5",
                  log.type === "success" && "text-success",
                  log.type === "info" && "text-muted-foreground",
                )}
              >
                {log.line !== undefined && <span className="text-muted-foreground me-2">L{log.line}</span>}
                {log.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
