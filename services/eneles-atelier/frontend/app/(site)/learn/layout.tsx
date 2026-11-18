import type { Metadata } from "next";
import { DocsShell } from "@/components/essential/docs/DocsShell";

export const metadata: Metadata = {
  title: { default: "Learn LaTeX", template: "%s - Learn LaTeX - Eneles" },
  description: "Short LaTeX lessons with examples compiled on the page: documents, mathematics, figures, tables, references, layout, slides, and drawing.",
};

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return <DocsShell manual="learn">{children}</DocsShell>;
}
