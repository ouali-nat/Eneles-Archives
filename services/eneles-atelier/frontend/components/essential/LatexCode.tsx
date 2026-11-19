import { TexSource } from "@/components/ui/tex-code";
import { cn } from "@/lib/utils";

/**
 * A block of LaTeX, colored. The coloring is the site's own (lib/tex-highlight.ts), written by hand rather than pulled from a highlighter library: it colors a handful of token kinds, knows that in a table or a circuit the `&` and `\\` separators carry the layout, and is drawn as React nodes, never as innerHTML, so nothing in the source can inject markup.
 */
export function LatexCode({ children, className }: { children: string; className?: string }) {
  return (
    <code className={cn("font-mono", className)}>
      <TexSource source={children} />
    </code>
  );
}
