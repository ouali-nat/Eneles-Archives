/**
 * TikZ code generator: converts canvas state to TikZ LaTeX code.
 */

export interface TikzNode {
  id: string;
  x: number;
  y: number;
  label: string;
  shape: "circle" | "rectangle" | "diamond" | "ellipse";
  /** Automata: is this a start state? */
  isInitial?: boolean;
  /** Automata: is this an accepting (double circle) state? */
  isAccepting?: boolean;
  /** Custom style overrides */
  style?: string;
}

export interface TikzEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** Edge style */
  style?: "solid" | "dashed" | "dotted";
  /** Bend direction: positive = bend left, negative = bend right, 0 = straight */
  bend?: number;
  /** Is this a self-loop? */
  isSelfLoop?: boolean;
  /** Arrow type */
  arrow?: "none" | "forward" | "backward" | "both";
}

export interface TikzState {
  nodes: TikzNode[];
  edges: TikzEdge[];
  mode: "graph" | "automaton" | "flowchart";
}

/**
 * Generate TikZ code from the canvas state.
 */
export function generateTikzCode(state: TikzState): string {
  const { nodes, edges, mode } = state;
  if (nodes.length === 0) return "";

  const lines: string[] = [];

  // Preamble based on mode
  if (mode === "automaton") {
    lines.push("\\begin{tikzpicture}[->, >=stealth, shorten >=1pt, auto, node distance=2.5cm, thick]");
    lines.push("  \\tikzstyle{every state}=[fill=none, draw=black, text=black]");
  } else if (mode === "flowchart") {
    lines.push("\\begin{tikzpicture}[node distance=2cm, auto,");
    lines.push("  block/.style={rectangle, draw, text width=5em, text centered, minimum height=3em, rounded corners},");
    lines.push("  decision/.style={diamond, draw, text width=4em, text centered, inner sep=0pt},");
    lines.push("  line/.style={draw, -stealth}]");
  } else {
    lines.push("\\begin{tikzpicture}[->, >=stealth, node distance=2cm, thick]");
  }

  lines.push("");

  // Scale coordinates to reasonable TikZ units (1 unit ≈ 100px)
  const scale = 0.02;

  // Nodes
  for (const node of nodes) {
    const x = (node.x * scale).toFixed(2);
    const y = (-node.y * scale).toFixed(2); // Flip Y axis

    if (mode === "automaton") {
      const styles: string[] = ["state"];
      if (node.isInitial) styles.push("initial");
      if (node.isAccepting) styles.push("accepting");
      lines.push(`  \\node[${styles.join(", ")}] (${node.id}) at (${x}, ${y}) {$${node.label}$};`);
    } else if (mode === "flowchart") {
      const style = node.shape === "diamond" ? "decision" : "block";
      lines.push(`  \\node[${style}] (${node.id}) at (${x}, ${y}) {${node.label}};`);
    } else {
      const shape = node.shape || "circle";
      lines.push(`  \\node[${shape}, draw] (${node.id}) at (${x}, ${y}) {${node.label}};`);
    }
  }

  lines.push("");

  // Edges
  if (edges.length > 0) {
    if (mode === "automaton") {
      lines.push("  \\path");
      for (const edge of edges) {
        const bendStr = edge.isSelfLoop
          ? "[loop above]"
          : edge.bend
          ? `[bend ${edge.bend > 0 ? "left" : "right"}=${Math.abs(edge.bend)}]`
          : "";
        const labelStr = edge.label ? ` node {${edge.label}}` : "";
        lines.push(`    (${edge.from}) edge ${bendStr}${labelStr} (${edge.to})`);
      }
      lines.push("  ;");
    } else {
      for (const edge of edges) {
        const arrowStyle =
          edge.arrow === "none"
            ? "-"
            : edge.arrow === "backward"
            ? "<-"
            : edge.arrow === "both"
            ? "<->"
            : "->";
        const lineStyle = edge.style === "dashed" ? "dashed" : edge.style === "dotted" ? "dotted" : "";
        const bendStr = edge.bend
          ? `bend ${edge.bend > 0 ? "left" : "right"}=${Math.abs(edge.bend)}`
          : "";
        const styles = [arrowStyle, lineStyle, bendStr].filter(Boolean).join(", ");
        const labelStr = edge.label ? ` node[midway, above] {${edge.label}}` : "";
        lines.push(`  \\draw[${styles}] (${edge.from}) --${labelStr} (${edge.to});`);
      }
    }
  }

  lines.push("");
  lines.push("\\end{tikzpicture}");

  return lines.join("\n");
}

/**
 * Create an initial empty state.
 */
export function createEmptyState(mode: TikzState["mode"] = "graph"): TikzState {
  return { nodes: [], edges: [], mode };
}
