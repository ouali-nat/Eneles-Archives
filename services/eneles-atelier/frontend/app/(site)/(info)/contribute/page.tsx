import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowRight, BookOpen, Bug, GraduationCap, Lightbulb, PenTool, Type } from "@/components/icons";
import { BrandMarks } from "@/components/BrandMarks";
import { SitePageHeader } from "@/components/essential/layout/SitePageHeader";
import { Repositories } from "@/components/essential/site/Repositories";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TexSource } from "@/components/ui/tex-code";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Contribute",
  description: "Help make Eneles better: report a bug, suggest a feature, fix the docs, write a lesson, add a TikZ figure, or send code.",
};

const SOURCE = siteConfig.links.source;

type Way = { icon: ComponentType<{ className?: string }>; hue: string; title: string; body: string; href: string; label: string };

const WAYS: Way[] = [
  { icon: Bug, hue: "text-hue-red bg-hue-red/12", title: "Report a bug", body: "What you did, what happened, and what you expected. A project link or the compile log helps most.", href: `${SOURCE}/frontend/issues/new`, label: "Open an issue" },
  { icon: Lightbulb, hue: "text-hue-amber bg-hue-amber/12", title: "Suggest a feature", body: "Tell us what slows your writing down. The best requests describe the paper, not the button.", href: `${SOURCE}/frontend/issues`, label: "See what others asked" },
  { icon: BookOpen, hue: "text-hue-teal bg-hue-teal/12", title: "Improve the docs", body: "Every page of the guides has an Edit link at its foot that opens the page's MDX file on GitHub Eneles.", href: `${SOURCE}/docs`, label: "Eneles docs" },
  { icon: GraduationCap, hue: "text-hue-blue bg-hue-blue/12", title: "Write a lesson", body: "Learn LaTeX is a set of short lessons with examples compiled on the page. New topics and clearer wording are both welcome.", href: `${SOURCE}/learn`, label: "Eneles learn" },
  { icon: PenTool, hue: "text-hue-green bg-hue-green/12", title: "Add a TikZ figure", body: "One .tex file with a Name and a Description at the top. It is compiled and rendered on every push, then appears in the Library and the editor.", href: `${SOURCE}/library`, label: "Eneles library" },
  { icon: Type, hue: "text-hue-purple bg-hue-purple/12", title: "Translate", body: "Eneles is in English for now. If you would help bring the interface or the guides to another language, write to us.", href: "/contact", label: "Get in touch" },
];

const FIGURE = `% Name: Shortest path
% Description: Dijkstra's result from A to F, the path in orange.
% Tags: shortest path, Dijkstra, weighted graph

\\usetikzlibrary{arrows.meta}

\\begin{tikzpicture}
  ...
\\end{tikzpicture}`;

const STEPS = [
  {
    title: "Clone the three repositories side by side",
    body: "The site, the API, and the compiler. Clone docs, learn, and library beside them too if you are working on content: the site reads them straight from those folders.",
    code: `git clone ${SOURCE}/frontend.git\ngit clone ${SOURCE}/backend.git\ngit clone ${SOURCE}/compiler.git`,
  },
  {
    title: "Start the compiler",
    body: "It needs TeX Live on your machine, or run its Docker image instead. It listens on port 3500.",
    code: "cd compiler\nnpm install\nnode server.js",
  },
  {
    title: "Start the API",
    body: "It needs PostgreSQL and Redis, and the variables listed in its README. It listens on port 2161.",
    code: "cd backend\nnpm install\nnpx prisma migrate deploy\nnpm run start:dev",
  },
  {
    title: "Start the site",
    body: "Set NEXT_PUBLIC_API_URL=http://localhost:2161 in .env.local, then open localhost:2160.",
    code: "cd frontend\nnpm install\nnpm run dev",
  },
];

const STYLE = [
  { title: "Sentence case", body: "For every heading, button, and menu item: “Add a reference”, not “Add A Reference”." },
  { title: "The Oxford comma", body: "Always: comments, suggestions, and history." },
  { title: "Plain words", body: "Say what happens, not what it is like. No marketing in the product." },
  { title: "Design tokens", body: "Colors, radii, and heights come from the theme, so both themes and every motion setting keep working." },
];

function Code({ code }: { code: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-background">
      {/* A title bar, so the copy button never sits on the commands. */}
      <div className="flex h-9 items-center justify-between border-b border-line ps-4 pe-1.5">
        <span className="type-small text-muted-foreground">Terminal</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-6">
        {code.split("\n").map((line, i) => (
          <div key={i}>
            <span aria-hidden className="me-3 text-muted-foreground/60 select-none">$</span>
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}

export default function ContributePage() {
  return (
    <div>
      <SitePageHeader title="Contribute" description="Eneles is built in the open. A bug report, a clearer paragraph in the docs, a new figure for the Library, and a pull request all make it better.">
        <Button asChild>
          <a href={SOURCE} target="_blank" rel="noreferrer">
            <BrandMarks.forgejo aria-hidden />
            Browse the source
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={siteConfig.links.github} target="_blank" rel="noreferrer">
            <BrandMarks.gitHub aria-hidden />
            GitHub mirror
          </a>
        </Button>
      </SitePageHeader>

      <div className="container flex flex-col gap-24 pb-24 @min-[40rem]:gap-32 @min-[40rem]:pb-32">
        {/* Ways to help, most of them no code at all. */}
        <section aria-labelledby="ways">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <h2 id="ways" className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">
              Ways to help
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">You do not need to write code. Some of the most useful help is a clear bug report or a better sentence.</p>
          </div>
          <div className="grid gap-4 @3xl:grid-cols-2 @5xl:grid-cols-3">
            {WAYS.map((way) => {
              const external = !way.href.startsWith("/");
              const Tag = external ? "a" : Link;
              return (
                <Tag key={way.title} href={way.href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} className="group flex flex-col rounded-[var(--radius-surface)] border border-line bg-card p-6 transition-colors hover:border-foreground/20 hover:bg-surface/40">
                  <span className={cn("grid size-10 place-items-center rounded-[var(--radius)]", way.hue)}>
                    <way.icon className="size-5" />
                  </span>
                  <h3 className="mt-5 type-large font-semibold tracking-[-0.01em]">{way.title}</h3>
                  <p className="mt-2 flex-1 type-base leading-relaxed text-muted-foreground text-pretty">{way.body}</p>
                  <span className={cn("mt-5 inline-flex items-center gap-1.5 type-base font-medium", way.label.startsWith("texer/") && "font-mono")}>
                    {way.label}
                    <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />
                  </span>
                </Tag>
              );
            })}
          </div>

          {/* What a Library figure looks like, since it is the easiest first contribution. */}
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-center gap-6 rounded-[var(--radius-surface)] border border-line bg-card p-6 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] @5xl:p-8">
            <div>
              <p className="type-small font-medium text-hue-green">An easy first contribution</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">A figure is one file</h3>
              <p className="mt-3 type-base leading-relaxed text-muted-foreground text-pretty">A comment header, the preamble lines the figure needs, and the figure. Add its name to nav.json, run the check, and the Library and the editor&rsquo;s figure picker have it on the next push.</p>
            </div>
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-background">
              <div className="flex h-9 items-center border-b border-line px-4 font-mono type-small text-muted-foreground">packages/graphs/shortest-path.tex</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-6 whitespace-pre">
                <TexSource source={FIGURE} />
              </pre>
            </div>
          </div>
        </section>

        {/* Running it locally. */}
        <section aria-labelledby="run">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <h2 id="run" className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">
              Run it on your machine
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">Three services, each its own repository. The README in each says everything it needs.</p>
          </div>
          <ol className="mx-auto flex max-w-4xl flex-col gap-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-[var(--radius-surface)] border border-line bg-card p-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @3xl:items-start">
                <div className="flex gap-4">
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border border-line font-mono type-small text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="type-large font-semibold tracking-[-0.01em]">{step.title}</h3>
                    <p className="mt-2 type-base leading-relaxed text-muted-foreground text-pretty [overflow-wrap:anywhere]">{step.body}</p>
                  </div>
                </div>
                <Code code={step.code} />
              </li>
            ))}
          </ol>
        </section>

        {/* House style. */}
        <section aria-labelledby="style">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <h2 id="style" className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">
              House style
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">A few rules that keep the product reading as one voice.</p>
          </div>
          <dl className="mx-auto grid max-w-4xl gap-4 @3xl:grid-cols-2">
            {STYLE.map((rule) => (
              <div key={rule.title} className="rounded-[var(--radius-surface)] border border-line bg-card p-6">
                <dt className="type-large font-semibold tracking-[-0.01em]">{rule.title}</dt>
                <dd className="mt-2 type-base leading-relaxed text-muted-foreground">{rule.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Where it all lives. */}
        <section aria-labelledby="repos">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <h2 id="repos" className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">
              The repositories
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">Each one on GitHub Eneles, with its issues and pull requests, and mirrored to GitHub.</p>
          </div>
          <Repositories />
        </section>

        <section aria-labelledby="ask" className="mx-auto w-full max-w-3xl rounded-[var(--radius-surface)] border border-line bg-card px-6 py-12 text-center @min-[40rem]:px-12">
          <h2 id="ask" className="text-2xl font-semibold tracking-[-0.02em]">
            Not sure where to start?
          </h2>
          <p className="mx-auto mt-3 max-w-xl type-base leading-relaxed text-muted-foreground text-pretty">Tell us what you would like to work on, and we will point you at a good first issue.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link href="/contact">
                Write to us
                <ArrowRight aria-hidden className="rtl:-scale-x-100" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a href={`${SOURCE}/frontend/issues`} target="_blank" rel="noreferrer">
                <BrandMarks.forgejo aria-hidden />
                Open issues
              </a>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
