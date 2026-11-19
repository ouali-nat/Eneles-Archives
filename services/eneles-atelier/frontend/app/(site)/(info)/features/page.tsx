import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "@/components/icons";
import { AiDemo, BuildDemo, CollabDemo, ConvertDemo, GithubDemo, PaletteDemo, ReferencesDemo, ReviewDemo, TikzDemo, VisualDemo } from "@/components/essential/features/FeatureDemos";
import { FeatureIndex } from "@/components/essential/features/FeatureIndex";
import { SitePageHeader } from "@/components/essential/layout/SitePageHeader";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Features",
  description: "Try Eneles's features on this page: real-time collaboration, track changes, image and PDF to LaTeX, the TikZ library, the AI assistant, builds, references, GitHub sync, and more.",
};

type Feature = {
  id: string;
  /** The section's one-word name in the index bar. */
  label: string;
  title: string;
  body: string;
  /** What to try in the demo. */
  hint: string;
  link: { label: string; href: string };
  plan?: string;
  demo: ReactNode;
};

/*
 * One section per feature, each with a small working replica of it (components/essential/features/FeatureDemos.tsx). Copy states only what the product does today; limits come from lib/plans.ts.
 */
const FEATURES: Feature[] = [
  {
    id: "collaboration",
    label: "Collaboration",
    title: "Write together, live",
    body: "Everyone edits the same document at the same time, with their name on their cursor. Collaboration is open to every Eneles member.",
    hint: "Type on line 3 while Euler and Gauss write around you.",
    link: { label: "Collaboration guide", href: "/docs/collaboration" },
    demo: <CollabDemo />,
  },
  {
    id: "review",
    label: "Review",
    title: "Track changes and comments",
    body: "Select a passage and suggest a rewrite instead of making it; the others accept or reject each one. Comments stay attached to their text, and viewers can comment too.",
    hint: "Accept one suggestion, reject the other, and reply to Plato.",
    link: { label: "Review guide", href: "/docs/review" },
    demo: <ReviewDemo />,
  },
  {
    id: "convert",
    label: "Convert",
    title: "Handwriting, screenshots, and PDFs to LaTeX",
    body: "Photograph your notes, snip an equation from a screenshot, or upload a PDF, and get source you can edit. There is no subscription quota for conversions; technical file-size and capacity safeguards still apply.",
    hint: "Pick another sample and watch it convert.",
    link: { label: "Image to LaTeX guide", href: "/docs/image-to-latex" },
    demo: <ConvertDemo />,
  },
  {
    id: "tikz",
    label: "TikZ",
    title: "A TikZ library that compiles",
    body: "Rendered, copyable figures for packages such as tikz-cd, quantikz, pgfplots, and circuitikz. Insert one from the editor and adapt it.",
    hint: "These are the library's real renders. Switch figures and copy the source.",
    link: { label: "Browse the library", href: "/library" },
    demo: <TikzDemo />,
  },
  {
    id: "ai",
    label: "Assistant",
    title: "An AI assistant, and dictation",
    body: "Ask for a change in plain words, typed or spoken. The assistant reads your project and any reference papers you attached, and every edit arrives as a diff you accept or reject.",
    hint: "Ask for a change, or press Dictate, then accept the diff.",
    link: { label: "See free access", href: "/pricing" },
    demo: <AiDemo />,
  },
  {
    id: "editing",
    label: "Editing",
    title: "Code or visual",
    body: "Write LaTeX with autocomplete for commands, citations, and labels, or switch to a view that shows headings, lists, and equations as they will look.",
    hint: "Switch between Code and Visual.",
    link: { label: "Visual mode guide", href: "/docs/visual-mode" },
    demo: <VisualDemo />,
  },
  {
    id: "compiling",
    label: "Builds",
    title: "Builds that finish",
    body: "Full TeX Live with pdfLaTeX, XeLaTeX, and LuaLaTeX. BibTeX or Biber, indexes, and glossaries run on their own, and errors point at the line that caused them.",
    hint: "Recompile, then break line 19 and recompile again.",
    link: { label: "Compiling guide", href: "/docs/compiling" },
    demo: <BuildDemo />,
  },
  {
    id: "references",
    label: "References",
    title: "Cite from a DOI or an arXiv ID",
    body: "Paste an identifier to add the BibTeX entry to your .bib file and cite it at the cursor. \\cite{ and \\ref{ then complete from your own keys and labels.",
    hint: "Add both sample papers.",
    link: { label: "References guide", href: "/docs/references" },
    demo: <ReferencesDemo />,
  },
  {
    id: "github",
    label: "GitHub",
    title: "GitHub sync, both ways",
    body: "Link a repository, then push and pull. A push is refused while GitHub has commits you have not pulled, so nobody's work is overwritten.",
    hint: "Push first, then Pull, then Push again.",
    link: { label: "GitHub sync guide", href: "/docs/github-sync" },
    demo: <GithubDemo />,
  },
  {
    id: "commands",
    label: "Palette",
    title: "Everything from the keyboard",
    body: "Press Shift and Space for the insert palette: snippets for tables, figures, matrices, and theorems, plus the whole TikZ library with previews.",
    hint: "Search for “table” or “matrix”, then press Enter, or press a number.",
    link: { label: "Keyboard shortcuts", href: "/docs/keyboard-shortcuts" },
    demo: <PaletteDemo />,
  },
];

const ALSO = [
  { title: "Reference papers", body: "Attach arXiv papers to a project with their full LaTeX source. Read them, compile them, and let the assistant use them as context." },
  { title: "Templates", body: "Start from a built-in template or one someone shared, and save any project as your own." },
  { title: "ZIP and arXiv import", body: "Bring a whole project in, folders and figures included, and download it as a ZIP at any time." },
  { title: "File history", body: "Thirty days of versions for every file, with labels and one-click restore." },
  { title: "Spell check", body: "Seven languages, with commands, math, and citations skipped." },
  { title: "Word count", body: "Follows \\input and \\include, and counts headings, captions, and footnotes separately." },
  { title: "Project chat", body: "A chat for everyone on the project, next to the document." },
  { title: "REST API", body: "Projects, compiling, and conversion from your own tools, with API keys." },
  { title: "Self-hosting", body: "Run the whole platform on your own servers when your data has to stay there." },
];

export default function FeaturesPage() {
  return (
    <div>
      <SitePageHeader title="Features" description="Every feature below is a working miniature of the real thing. Try each one right here, without an account." className="pb-10 @min-[40rem]:pb-12" />
      <FeatureIndex items={FEATURES.map(({ id, label }) => ({ id, label }))} />

      <div className="container flex flex-col pb-28">
        {FEATURES.map((f, i) => (
          // The words sit beside the demo, centred on it; on a narrow window they sit above it.
          <section key={f.id} id={f.id} aria-labelledby={`${f.id}-title`} className="grid scroll-mt-32 items-center gap-x-16 gap-y-8 border-line py-16 @min-[40rem]:py-24 @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] [&+&]:border-t">
            <div>
              <p className="flex items-center gap-2 type-small text-muted-foreground">
                <span className="font-mono tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span>{f.label}</span>
                {f.plan && <span className="ms-1 rounded-full border border-line px-2 py-0.5">{f.plan}</span>}
              </p>
              <h2 id={`${f.id}-title`} className="mt-3 text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-balance @min-[40rem]:text-4xl">
                {f.title}
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">{f.body}</p>
              {/* What to do in the demo, then where to read more. */}
              <p className="mt-6 type-base text-pretty">
                <span className="font-medium text-foreground">Try it: </span>
                <span className="text-muted-foreground">{f.hint}</span>
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link href={f.link.href}>
                  {f.link.label}
                  <ArrowRight aria-hidden className="rtl:-scale-x-100" />
                </Link>
              </Button>
            </div>
            <div className="@container min-w-0">{f.demo}</div>
          </section>
        ))}

        <section aria-labelledby="also-title" className="border-t border-line py-16 @min-[40rem]:py-24">
          <p className="flex items-center gap-2 type-small text-muted-foreground">
            <span className="font-mono tabular-nums">{String(FEATURES.length + 1).padStart(2, "0")}</span>
            <span>Also</span>
          </p>
          <h2 id="also-title" className="mt-4 text-3xl font-semibold tracking-[-0.02em] @min-[40rem]:text-4xl">
            And the rest
          </h2>
          <dl className="mt-10 grid gap-3 @min-[40rem]:grid-cols-2 @5xl:grid-cols-3">
            {ALSO.map((item) => (
              <div key={item.title} className="rounded-[var(--radius-card)] border border-line bg-card p-5">
                <dt className="type-large font-semibold">{item.title}</dt>
                <dd className="mt-2 type-base leading-relaxed text-muted-foreground text-pretty">{item.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col items-center gap-6 rounded-[var(--radius-surface)] border border-line bg-card px-6 py-16 text-center">
          <h2 className="text-3xl font-semibold tracking-[-0.02em] @min-[40rem]:text-4xl">Now try the real thing.</h2>
          <p className="max-w-xl text-lg text-muted-foreground text-pretty">Free for unlimited projects and collaborators. No card, and your work stays plain LaTeX you can take anywhere.</p>
          <div className="flex flex-col gap-3 @min-[40rem]:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Create a free account
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">See what is included</Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
