import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { BookOpen, Download, GraduationCap, Heart, Lock, Server, Users } from "@/components/icons";
import { BrandMarks } from "@/components/BrandMarks";
import { CTASection } from "@/components/essential/home/CTASection";
import { SitePageHeader } from "@/components/essential/layout/SitePageHeader";
import { Repositories } from "@/components/essential/site/Repositories";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "About",
  description: "Why Eneles exists, what it holds to, who it is for, and where its source lives.",
};

type Card = { icon: ComponentType<{ className?: string }>; hue: string; title: string; body: string };

const PRINCIPLES: Card[] = [
  { icon: Users, hue: "text-hue-blue bg-hue-blue/12", title: "Writing together is free", body: "Tous les outils sont accessibles gratuitement : collaboration, historique, synchronisation, conversions et stockage, dans les limites techniques du service." },
  { icon: Download, hue: "text-hue-green bg-hue-green/12", title: "Your files stay yours", body: "A project is plain .tex files and the images beside them. Download it as a ZIP or push it to GitHub whenever you like, and take it anywhere." },
  { icon: Lock, hue: "text-hue-purple bg-hue-purple/12", title: "Your documents are not training data", body: "Les documents ne servent pas à entraîner des modèles. Les traitements IA dépendent du fournisseur configuré et de sa politique de confidentialité." },
  { icon: Heart, hue: "text-hue-red bg-hue-red/12", title: "Built in the open", body: "The source is public on our own Git server, the changelog says what changed, and the issue tracker is where we hear what is wrong." },
];

const AUDIENCES: Card[] = [
  { icon: GraduationCap, hue: "text-hue-amber bg-hue-amber/12", title: "Students", body: "A thesis written with a supervisor who comments and suggests changes in the same document, instead of over email." },
  { icon: Users, hue: "text-hue-blue bg-hue-blue/12", title: "Research groups", body: "A paper with five co-authors, one bibliography, and a GitHub repository, without paying per seat for any of it." },
  { icon: BookOpen, hue: "text-hue-teal bg-hue-teal/12", title: "Teaching staff", body: "Problem sets, lecture notes, and exams built from templates and a library of figures that compile." },
  { icon: Server, hue: "text-hue-purple bg-hue-purple/12", title: "Departments", body: "The whole platform on your own servers when your data policy asks for it, from the same source we run." },
];

function Cards({ items }: { items: Card[] }) {
  return (
    <div className="grid gap-4 @3xl:grid-cols-2">
      {items.map((item) => (
        <div key={item.title} className="flex gap-4 rounded-[var(--radius-surface)] border border-line bg-card p-6">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-[var(--radius)]", item.hue)}>
            <item.icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="type-large font-semibold tracking-[-0.01em]">{item.title}</h3>
            <p className="mt-2 type-base leading-relaxed text-muted-foreground text-pretty">{item.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mx-auto mb-10 max-w-3xl text-center">
      <h2 className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">{title}</h2>
      {lede && <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">{lede}</p>}
    </div>
  );
}

export default function AboutPage() {
  return (
    <div>
      <SitePageHeader title="About" description="Eneles is a LaTeX workspace for everything a paper needs, made for the way papers are actually written: by several people, at once, against a deadline." />

      <div className="container flex flex-col gap-24 pb-8 @min-[40rem]:gap-32">
        {/* Why: the claim large on one side, the story on the other. */}
        <section aria-labelledby="why" className="grid gap-10 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] @5xl:gap-16">
          <div>
            <p className="type-small font-medium text-muted-foreground">Why it exists</p>
            <h2 id="why" className="mt-3 text-3xl leading-[1.15] font-semibold tracking-[-0.025em] text-balance @min-[40rem]:text-[2.6rem]">
              Papers are written by groups. Most LaTeX tools were built for one person.
            </h2>
          </div>
          <div className="flex flex-col gap-5 text-lg leading-relaxed text-muted-foreground text-pretty">
            <p>Sur de nombreux outils, les collaborateurs supplémentaires ou les révisions sont payants. Figures are drawn somewhere else, references are copied in from a third place, and the version that was sent to the journal lives in someone&rsquo;s email.</p>
            <p>
              Eneles keeps all of it in one project: <span className="text-foreground">writing in code or in Visual mode</span>, <span className="text-foreground">comments and suggestions</span>, <span className="text-foreground">a library of figures</span>, <span className="text-foreground">references from a DOI</span>, <span className="text-foreground">GitHub in both directions</span>, and <span className="text-foreground">every version</span>, with the full TeX Live compiling underneath.
            </p>
            <p>Toutes les fonctions sont ouvertes sans abonnement : chacun peut rédiger, convertir et collaborer.</p>
          </div>
        </section>

        <section aria-labelledby="principles">
          <div id="principles">
            <SectionTitle title="What we hold to" lede="Four promises the product is built around, and that the pricing will not quietly undo." />
          </div>
          <Cards items={PRINCIPLES} />
        </section>

        <section aria-labelledby="audiences">
          <div id="audiences">
            <SectionTitle title="Who it is for" lede="Anyone whose writing has equations in it, and anyone writing it with them." />
          </div>
          <Cards items={AUDIENCES} />
        </section>

        <section aria-labelledby="open">
          <div id="open">
            <SectionTitle title="Built in the open" lede="The source lives on our own Git server, mirrored to GitHub. Run it yourself, read how it works, or send a fix." />
          </div>
          <Repositories />
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <a href={siteConfig.links.source} target="_blank" rel="noreferrer">
                <BrandMarks.forgejo aria-hidden />
                Browse the source
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={siteConfig.links.github} target="_blank" rel="noreferrer">
                <BrandMarks.gitHub aria-hidden />
                GitHub
              </a>
            </Button>
            <Button asChild variant="outline">
              <Link href="/contribute">Contribute</Link>
            </Button>
          </div>
        </section>
      </div>

      <CTASection />
    </div>
  );
}
