import { DocsShell } from "@/components/essential/docs/DocsShell";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsShell manual="docs">{children}</DocsShell>;
}
