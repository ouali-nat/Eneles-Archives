import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { BookOpen, Mail, Users } from "@/components/icons";
import { BrandMarks } from "@/components/BrandMarks";
import { SitePageHeader } from "@/components/essential/layout/SitePageHeader";
import { ContactForm } from "@/components/essential/site/ContactForm";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Contact Eneles",
  description: "Écrivez à l’équipe Eneles au sujet de l’atelier ou de votre compte.",
};

type Way = { icon: ComponentType<{ className?: string }>; hue: string; title: string; body: string; href: string; label: string; external?: boolean };

const WAYS: Way[] = [
  { icon: Mail, hue: "text-hue-blue bg-hue-blue/12", title: "Assistance Eneles", body: "Une question sur votre compte, un projet ou une compilation ?", href: siteConfig.contact.support, label: "Formulaire de contact" },
  { icon: Users, hue: "text-hue-purple bg-hue-purple/12", title: "Équipes et établissements", body: "Parlons des usages collectifs et du déploiement d’Eneles.", href: siteConfig.contact.sales, label: "Contacter Eneles" },
  { icon: BrandMarks.forgejo, hue: "text-hue-amber bg-hue-amber/12", title: "Bugs and ideas", body: "Open an issue where the source lives, and follow it as it is fixed.", href: `${siteConfig.links.github}/issues`, label: "Issues GitHub Eneles", external: true },
  { icon: BookOpen, hue: "text-hue-green bg-hue-green/12", title: "How do I…", body: "Most questions are answered in the guides, with pictures.", href: "/docs", label: "Read the docs" },
];

export default function ContactPage() {
  return (
    <div>
      <SitePageHeader title="Contact Eneles" description="Une question, un problème ou une idée ? Écrivez à l’équipe Eneles via ce formulaire." />

      <section className="container pb-24 @min-[40rem]:pb-32">
        <div className="mx-auto grid max-w-6xl items-start gap-8 @5xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] @5xl:gap-12">
          <ContactForm />

          <aside aria-label="Other ways to reach us" className="flex flex-col gap-3">
            <h2 className="type-small font-medium text-muted-foreground">Or reach us another way</h2>
            {WAYS.map((way) => {
              const inner = (
                <>
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-[var(--radius)] [&_svg]:size-5", way.hue)}>
                    <way.icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block type-base font-semibold">{way.title}</span>
                    <span className="mt-1 block type-base leading-relaxed text-muted-foreground">{way.body}</span>
                    <span className="mt-2 block type-base font-medium underline-offset-4 group-hover:underline">{way.label}</span>
                  </span>
                </>
              );
              const className = "group flex gap-4 rounded-[var(--radius-surface)] border border-line bg-card p-5 transition-colors hover:border-foreground/20 hover:bg-surface/40";
              return way.href.startsWith("/") ? (
                <Link key={way.title} href={way.href} className={className}>
                  {inner}
                </Link>
              ) : (
                <a key={way.title} href={way.href} target={way.external ? "_blank" : undefined} rel={way.external ? "noreferrer" : undefined} className={className}>
                  {inner}
                </a>
              );
            })}
          </aside>
        </div>
      </section>
    </div>
  );
}
