"use client";

import { useState } from "react";
import { TikzCanvas } from "./tikz/TikzCanvas";
import { Button } from "@/components/ui/button";
import { X, Maximize2, Minimize2 } from "@/components/icons";

interface DrawingPanelProps {
  onInsertCode: (code: string) => void;
  onClose: () => void;
}

export function DrawingPanel({ onInsertCode, onClose }: DrawingPanelProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  return (
    <div
      className={
        isMaximized
          ? "fixed inset-4 z-50 bg-background border rounded-lg shadow-2xl flex flex-col"
          : "flex flex-col h-full"
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-surface/30 shrink-0">
        <span className="text-xs font-semibold">TikZ Drawing Tool</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsMaximized((v) => !v)}
          >
            {isMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button variant="ghost" size="icon" className="w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0">
        <TikzCanvas onInsertCode={onInsertCode} />
      </div>

      {/* Backdrop for maximized mode */}
      {isMaximized && (
        <div
          className="fixed inset-0 z-[-1] bg-overlay"
          onClick={() => setIsMaximized(false)}
        />
      )}
    </div>
  );
}
