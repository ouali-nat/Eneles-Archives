import { BookOpen, ExternalLink, Code2, FileCode, GraduationCap, PenTool, Server } from "@/components/icons";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/** The repositories Eneles is made of, on our own Git server: what each holds, in a sentence. */
export const REPOSITORIES = [
  { name: "frontend", icon: Code2, hue: "text-hue-blue bg-hue-blue/12", what: "The site and the editor: Next.js, CodeMirror, live editing over Yjs, the PDF viewer, and Visual mode." },
  { name: "backend", icon: Server, hue: "text-hue-purple bg-hue-purple/12", what: "The API: accounts, projects, comments and chat, history, GitHub sync, the assistant, and project access. NestJS and PostgreSQL." },
  { name: "compiler", icon: FileCode, hue: "text-hue-amber bg-hue-amber/12", what: "Compiles projects with the full TeX Live in a sandbox, with BibTeX, Biber, and indexes run as needed." },
  { name: "library", icon: PenTool, hue: "text-hue-green bg-hue-green/12", what: "Every TikZ figure in the Library: one .tex file each, checked and rendered on every push." },
  { name: "docs", icon: BookOpen, hue: "text-hue-teal bg-hue-teal/12", what: "The guides at /docs, one MDX page each, with an Edit link on every page of the site." },
  { name: "learn", icon: GraduationCap, hue: "text-hue-red bg-hue-red/12", what: "The LaTeX lessons at /learn, with examples compiled right on the page." },
] as const;

/** The repositories as a list of links, each to its page on GitHub Eneles. */
export function Repositories({ className }: { className?: string }) {
  return (
    <ul className={cn("grid gap-3 @3xl:grid-cols-2", className)}>
      {REPOSITORIES.map((repo) => (
        <li key={repo.name}>
          <a href={`${siteConfig.links.source}/${repo.name}`} target="_blank" rel="noreferrer" className="group flex h-full items-start gap-4 rounded-[var(--radius-surface)] border border-line bg-card p-5 transition-colors hover:border-foreground/20 hover:bg-surface/40">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-[var(--radius)]", repo.hue)}>
              <repo.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-mono type-base font-medium">
                Eneles/{repo.name}
                <ExternalLink aria-hidden className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className="mt-1.5 block type-base leading-relaxed text-muted-foreground">{repo.what}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
