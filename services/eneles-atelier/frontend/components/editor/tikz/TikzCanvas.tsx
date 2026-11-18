"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  type TikzNode,
  type TikzEdge,
  type TikzState,
  createEmptyState,
  generateTikzCode,
} from "./tikz-export";
import { DiagramPalette, type CanvasTool } from "./DiagramPalette";

interface TikzCanvasProps {
  onInsertCode: (code: string) => void;
  className?: string;
}

let nodeCounter = 0;
let edgeCounter = 0;

export function TikzCanvas({ onInsertCode, className }: TikzCanvasProps) {
  const [state, setState] = useState<TikzState>(createEmptyState("graph"));
  const [tool, setTool] = useState<CanvasTool>("node-circle");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [edgeStart, setEdgeStart] = useState<string | null>(null);
  const [dragNode, setDragNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [history, setHistory] = useState<TikzState[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);

  // Push state to history for undo
  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev.slice(-20), structuredClone(state)]);
  }, [state]);

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setState(last);
      return prev.slice(0, -1);
    });
  }, []);

  const handleClear = useCallback(() => {
    pushHistory();
    setState((prev) => ({ ...prev, nodes: [], edges: [] }));
  }, [pushHistory]);

  // Get SVG coordinates from mouse event
  const getSvgCoords = (e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Find node at position
  const findNodeAt = (x: number, y: number): TikzNode | null => {
    for (const node of state.nodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      if (Math.sqrt(dx * dx + dy * dy) < 30) return node;
    }
    return null;
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    const { x, y } = getSvgCoords(e);
    const clickedNode = findNodeAt(x, y);

    if (tool === "select") {
      setSelectedNodeId(clickedNode?.id || null);
      setEdgeStart(null);
      return;
    }

    if (tool === "delete") {
      if (clickedNode) {
        pushHistory();
        setState((prev) => ({
          ...prev,
          nodes: prev.nodes.filter((n) => n.id !== clickedNode.id),
          edges: prev.edges.filter((e) => e.from !== clickedNode.id && e.to !== clickedNode.id),
        }));
      }
      return;
    }

    if (tool === "edge") {
      if (clickedNode) {
        if (edgeStart === null) {
          setEdgeStart(clickedNode.id);
        } else {
          pushHistory();
          const id = `e${edgeCounter++}`;
          const isSelfLoop = edgeStart === clickedNode.id;
          setState((prev) => ({
            ...prev,
            edges: [
              ...prev.edges,
              {
                id,
                from: edgeStart,
                to: clickedNode.id,
                label: "",
                arrow: "forward",
                isSelfLoop,
                bend: isSelfLoop ? 0 : 0,
              },
            ],
          }));
          setEdgeStart(null);
        }
      }
      return;
    }

    // Node creation tools
    if (tool.startsWith("node-") && !clickedNode) {
      pushHistory();
      const shape = tool === "node-circle" ? "circle" : tool === "node-rect" ? "rectangle" : "diamond";
      const id = `n${nodeCounter++}`;
      const label = state.mode === "automaton" ? `q_{${state.nodes.length}}` : String.fromCharCode(65 + state.nodes.length);

      setState((prev) => ({
        ...prev,
        nodes: [
          ...prev.nodes,
          { id, x, y, label, shape, isInitial: prev.nodes.length === 0 && state.mode === "automaton" },
        ],
      }));
    }
  };

  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if (tool === "select") {
      e.stopPropagation();
      const { x, y } = getSvgCoords(e);
      const node = state.nodes.find((n) => n.id === nodeId);
      if (node) {
        setDragNode(nodeId);
        setDragOffset({ x: x - node.x, y: y - node.y });
        setSelectedNodeId(nodeId);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragNode) {
      const { x, y } = getSvgCoords(e);
      setState((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === dragNode ? { ...n, x: x - dragOffset.x, y: y - dragOffset.y } : n
        ),
      }));
    }
  };

  const handleMouseUp = () => {
    if (dragNode) {
      pushHistory();
      setDragNode(null);
    }
  };

  // Double-click to edit label
  const handleNodeDoubleClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = state.nodes.find((n) => n.id === nodeId);
    if (node) {
      setEditingNodeId(nodeId);
      setEditValue(node.label);
    }
  };

  const handleEdgeDoubleClick = (e: React.MouseEvent, edgeId: string) => {
    e.stopPropagation();
    const edge = state.edges.find((ed) => ed.id === edgeId);
    if (edge) {
      setEditingEdgeId(edgeId);
      setEditValue(edge.label || "");
    }
  };

  const commitEdit = () => {
    if (editingNodeId) {
      setState((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === editingNodeId ? { ...n, label: editValue } : n
        ),
      }));
      setEditingNodeId(null);
    }
    if (editingEdgeId) {
      setState((prev) => ({
        ...prev,
        edges: prev.edges.map((e) =>
          e.id === editingEdgeId ? { ...e, label: editValue } : e
        ),
      }));
      setEditingEdgeId(null);
    }
  };

  // Toggle accepting state (automaton mode)
  const toggleAccepting = (nodeId: string) => {
    setState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === nodeId ? { ...n, isAccepting: !n.isAccepting } : n
      ),
    }));
  };

  // Insert generated code
  const handleInsert = () => {
    const code = generateTikzCode(state);
    if (code) onInsertCode(code);
  };

  // Render node shape
  const renderNode = (node: TikzNode) => {
    const isSelected = selectedNodeId === node.id;
    const isEdgeOrigin = edgeStart === node.id;

    const shapeProps = {
      stroke: isSelected ? "var(--accent)" : isEdgeOrigin ? "#22c55e" : "currentColor",
      strokeWidth: isSelected || isEdgeOrigin ? 2.5 : 1.5,
      fill: "var(--background)",
      className: "cursor-pointer",
    };

    return (
      <g
        key={node.id}
        onMouseDown={(e) => handleMouseDown(e, node.id)}
        onDoubleClick={(e) => handleNodeDoubleClick(e, node.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (state.mode === "automaton") toggleAccepting(node.id);
        }}
      >
        {/* Shape */}
        {node.shape === "circle" || state.mode === "automaton" ? (
          <>
            <circle cx={node.x} cy={node.y} r={25} {...shapeProps} />
            {node.isAccepting && (
              <circle cx={node.x} cy={node.y} r={20} {...shapeProps} fill="none" />
            )}
          </>
        ) : node.shape === "rectangle" ? (
          <rect x={node.x - 30} y={node.y - 20} width={60} height={40} rx={4} {...shapeProps} />
        ) : (
          <polygon
            points={`${node.x},${node.y - 25} ${node.x + 30},${node.y} ${node.x},${node.y + 25} ${node.x - 30},${node.y}`}
            {...shapeProps}
          />
        )}

        {/* Initial arrow */}
        {node.isInitial && (
          <line
            x1={node.x - 50}
            y1={node.y}
            x2={node.x - 27}
            y2={node.y}
            stroke="currentColor"
            strokeWidth={1.5}
            markerEnd="url(#arrowhead)"
          />
        )}

        {/* Label */}
        {editingNodeId === node.id ? (
          <foreignObject x={node.x - 25} y={node.y - 10} width={50} height={20}>
            <input
              className="w-full h-full text-center text-xs bg-background border rounded outline-none"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") { setEditingNodeId(null); }
              }}
              onBlur={commitEdit}
              autoFocus
            />
          </foreignObject>
        ) : (
          <text
            x={node.x}
            y={node.y + 4}
            textAnchor="middle"
            className="text-xs fill-current select-none pointer-events-none"
            style={{ fontSize: "12px" }}
          >
            {node.label}
          </text>
        )}
      </g>
    );
  };

  // Render edge
  const renderEdge = (edge: TikzEdge) => {
    const fromNode = state.nodes.find((n) => n.id === edge.from);
    const toNode = state.nodes.find((n) => n.id === edge.to);
    if (!fromNode || !toNode) return null;

    if (edge.isSelfLoop) {
      // Self-loop: draw a loop above the node
      return (
        <g key={edge.id} onDoubleClick={(e) => handleEdgeDoubleClick(e, edge.id)}>
          <path
            d={`M ${fromNode.x - 10} ${fromNode.y - 25} C ${fromNode.x - 30} ${fromNode.y - 60}, ${fromNode.x + 30} ${fromNode.y - 60}, ${fromNode.x + 10} ${fromNode.y - 25}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            markerEnd="url(#arrowhead)"
            className="cursor-pointer"
          />
          {edge.label && (
            <text
              x={fromNode.x}
              y={fromNode.y - 55}
              textAnchor="middle"
              className="text-xs fill-current"
              style={{ fontSize: "11px" }}
            >
              {edge.label}
            </text>
          )}
        </g>
      );
    }

    // Straight edge with optional label
    const mx = (fromNode.x + toNode.x) / 2;
    const my = (fromNode.y + toNode.y) / 2;

    return (
      <g key={edge.id} onDoubleClick={(e) => handleEdgeDoubleClick(e, edge.id)}>
        <line
          x1={fromNode.x}
          y1={fromNode.y}
          x2={toNode.x}
          y2={toNode.y}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray={edge.style === "dashed" ? "5,5" : edge.style === "dotted" ? "2,2" : undefined}
          markerEnd="url(#arrowhead)"
          className="cursor-pointer"
        />
        {editingEdgeId === edge.id ? (
          <foreignObject x={mx - 25} y={my - 20} width={50} height={20}>
            <input
              className="w-full h-full text-center text-xs bg-background border rounded outline-none"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") { setEditingEdgeId(null); }
              }}
              onBlur={commitEdit}
              autoFocus
            />
          </foreignObject>
        ) : edge.label ? (
          <text
            x={mx}
            y={my - 8}
            textAnchor="middle"
            className="text-xs fill-current"
            style={{ fontSize: "11px" }}
          >
            {edge.label}
          </text>
        ) : null}
      </g>
    );
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      <DiagramPalette
        activeTool={tool}
        onToolSelect={setTool}
        onClear={handleClear}
        onUndo={handleUndo}
        mode={state.mode}
        onModeChange={(mode) => setState((prev) => ({ ...prev, mode }))}
      />

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <svg
          ref={svgRef}
          className="w-full h-full"
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="10"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
            </marker>
          </defs>

          {/* Grid */}
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--surface)" strokeWidth="0.5" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Edges (render below nodes) */}
          {state.edges.map(renderEdge)}

          {/* Edge being drawn */}
          {edgeStart && (
            <circle
              cx={state.nodes.find((n) => n.id === edgeStart)?.x || 0}
              cy={state.nodes.find((n) => n.id === edgeStart)?.y || 0}
              r={28}
              fill="none"
              stroke="#22c55e"
              strokeWidth={2}
              strokeDasharray="4,4"
              className="animate-pulse"
            />
          )}

          {/* Nodes */}
          {state.nodes.map(renderNode)}
        </svg>

        {/* Hint text */}
        {state.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-muted-foreground">
              Click on the canvas to add nodes. Select edge tool to connect them.
            </p>
          </div>
        )}
      </div>

      {/* Insert button */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t bg-surface/30">
        <p className="text-xs text-muted-foreground">
          {state.nodes.length} nodes, {state.edges.length} edges
          {state.mode === "automaton" && " | Right-click node to toggle accepting"}
        </p>
        <button
          className="text-xs font-medium text-foreground hover:underline"
          onClick={handleInsert}
          disabled={state.nodes.length === 0}
        >
          Insert TikZ Code
        </button>
      </div>
    </div>
  );
}
