import type { Metadata } from "next";
import { SitePageHeader } from "@/components/essential/layout/SitePageHeader";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What changed in each release of Eneles.",
};

type Group = { label: "Added" | "Improved" | "Fixed"; items: string[] };

/** A little color for each kind of change: the label's chip and the dot before each item. */
const TONE: Record<Group["label"], { chip: string; dot: string }> = {
  Added: { chip: "border-success/30 bg-success/10 text-success", dot: "bg-success" },
  Improved: { chip: "border-hue-blue/30 bg-hue-blue/10 text-hue-blue", dot: "bg-hue-blue" },
  Fixed: { chip: "border-hue-amber/30 bg-hue-amber/10 text-hue-amber", dot: "bg-hue-amber" },
};
type Release = { version: string; date: string; title: string; summary?: string; groups: Group[] };

/*
 * Newest first. Each item is one change a user can see, in a sentence, with no marketing. Add a release at the top when the version in package.json changes.
 */
const RELEASES: Release[] = [
  {
    version: "1.0.0",
    date: "November 2026",
    title: "The whole paper, in one place",
    summary: "The first release we call complete: converting, writing, reviewing, citing, and building all happen in one editor.",
    groups: [
      {
        label: "Added",
        items: [
          "Comments, suggested changes with accept and reject, and a project chat.",
          "Visual mode: headings, lists, equations, images, and citations drawn in place, beside the code view.",
          "GitHub sync in both directions, with pull-before-push and both versions kept on a conflict.",
          "References from a DOI or an arXiv ID, with completion for citation keys and labels.",
          "Reference papers: attach arXiv papers to a project with their LaTeX source, for you and the assistant to read.",
          "A dockable workspace: move, tab, split, and resize every panel, with layouts in the View menu.",
          "Spell check in seven languages, a word count that follows included files, and saved templates with review before sharing.",
          "Learn LaTeX: lessons with examples compiled on the page.",
          "A Features page where every feature can be tried without an account.",
        ],
      },
      {
        label: "Improved",
        items: [
          "Compiling runs BibTeX or Biber, indexes, and glossaries on its own, and errors point at the file and line that caused them.",
          "Jumping between the PDF and the source works in both directions and across files.",
          "ZIP and arXiv imports bring every file and folder, and images are stored with the project.",
          "The assistant proposes every edit as a diff, and can be used as a panel or a floating dock.",
          "One design across the site and the app: the same headers, buttons, icons, and motion everywhere.",
          "File → Download PDF works from any layout, and the file is named after the project.",
          "Error messages say what went wrong when the compiler, arXiv, or GitHub refuses a request.",
        ],
      },
      {
        label: "Fixed",
        items: [
          "Creating a file or folder inside a folder no longer cancels itself.",
          "Menus and dialogs no longer make the page jump or hide the header on a scrolled page.",
          "Draft mode and the LaTeX engine produce a PDF.",
          "Library previews no longer run into the rate limit while browsing.",
          "A table of contents, a list of figures, and beamer navigation fill in on the first compile, and documents that load hyperref compile in two passes, not five.",
          "A compile started straight after typing uses the new text.",
          "The first file opened in a project joins live editing straight away.",
          "Accepting the assistant's changes to one file keeps the rest of its proposal, and accepted changes are saved in every file.",
          "Ending a session in Settings signs that browser out at once, and the list shows which session is yours.",
          "Invitation links, and the template chosen with Use this template, open correctly.",
        ],
      },
    ],
  },
  {
    version: "0.x",
    date: "November 2024 to October 2026",
    title: "The foundations",
    groups: [
      {
        label: "Added",
        items: [
          "The LaTeX editor with a live PDF preview, multi-file projects, and real-time editing.",
          "Image and PDF to LaTeX conversion.",
          "The TikZ library and the visual TikZ studio.",
          "The AI assistant and dictation.",
          "Accounts, sharing, plans, API keys, and the REST API.",
        ],
      },
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div>
      <SitePageHeader title="Changelog" description="What changed in each release." />

      <div className="container flex flex-col gap-20 pb-28">
        {RELEASES.map((release) => (
          <article key={release.version} aria-labelledby={`v-${release.version}`} className="grid gap-x-16 gap-y-4 @3xl:grid-cols-[14rem_minmax(0,1fr)]">
            <header className="@3xl:sticky @3xl:top-24 @3xl:self-start">
              <p className="font-mono text-2xl font-semibold tracking-[-0.02em]">{release.version}</p>
              {release === RELEASES[0] && <p className="mt-2 inline-flex h-6 items-center gap-1.5 rounded-full bg-accent px-2.5 type-small font-medium text-on-accent">Latest</p>}
              <p className="mt-1 type-base text-muted-foreground">{release.date}</p>
            </header>
            {/* The release's text keeps a reading measure inside the wider page. */}
            <div className="max-w-3xl">
              <h2 id={`v-${release.version}`} className="text-2xl font-semibold tracking-[-0.02em]">
                {release.title}
              </h2>
              {release.summary && <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{release.summary}</p>}
              <div className="mt-8 flex flex-col gap-8">
                {release.groups.map((group) => (
                  <section key={group.label} aria-label={group.label}>
                    <h3 className={cn("inline-flex h-7 items-center rounded-full border px-2.5 type-small font-medium", TONE[group.label].chip)}>{group.label}</h3>
                    <ul className="mt-3 flex flex-col">
                      {group.items.map((item) => (
                        <li key={item} className="flex gap-3 border-t border-line py-3 leading-relaxed first:border-t-0 first:pt-1">
                          <span aria-hidden className={cn("mt-[0.6em] size-1.5 shrink-0 rounded-full", TONE[group.label].dot)} />
                          <span className="min-w-0">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
