"use client";

import { Circle, Square, Diamond, ArrowRight, MousePointer2, Trash2, RotateCcw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type CanvasTool = "select" | "node-circle" | "node-rect" | "node-diamond" | "edge" | "delete";

interface DiagramPaletteProps {
  activeTool: CanvasTool;
  onToolSelect: (tool: CanvasTool) => void;
  onClear: () => void;
  onUndo: () => void;
  mode: "graph" | "automaton" | "flowchart";
  onModeChange: (mode: "graph" | "automaton" | "flowchart") => void;
}

export function DiagramPalette({
  activeTool,
  onToolSelect,
  onClear,
  onUndo,
  mode,
  onModeChange,
}: DiagramPaletteProps) {
  const tools: { id: CanvasTool; icon: typeof Circle; label: string }[] = [
    { id: "select", icon: MousePointer2, label: "Select / Move" },
    { id: "node-circle", icon: Circle, label: "Circle node" },
    { id: "node-rect", icon: Square, label: "Rectangle node" },
    { id: "node-diamond", icon: Diamond, label: "Diamond node" },
    { id: "edge", icon: ArrowRight, label: "Draw edge" },
    { id: "delete", icon: Trash2, label: "Delete" },
  ];

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b bg-surface/30">
      {/* Mode selector */}
      <div className="flex items-center gap-0.5 me-2">
        {(["graph", "automaton", "flowchart"] as const).map((m) => (
          <Button
            key={m}
            variant={mode === m ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => onModeChange(m)}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </Button>
        ))}
      </div>

      <Separator orientation="vertical" className="h-5" />

      {/* Tools */}
      <div className="flex items-center gap-0.5 mx-1">
        {tools.map(({ id, icon: Icon, label }) => (
          <Button
            key={id}
            variant={activeTool === id ? "secondary" : "ghost"}
            size="icon"
            className={cn("h-7 w-7", activeTool === id && "ring-1 ring-accent")}
            onClick={() => onToolSelect(id)}
            title={label}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
      </div>

      <Separator orientation="vertical" className="h-5" />

      {/* Actions */}
      <div className="flex items-center gap-0.5 ms-1">
        <Button variant="ghost" size="icon" className="w-7" onClick={onUndo} title="Undo">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="w-7" onClick={onClear} title="Clear canvas">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
