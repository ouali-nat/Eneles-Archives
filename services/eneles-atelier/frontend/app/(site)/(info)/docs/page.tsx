import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "@/components/icons";
import { docsGroups, docHref } from "@/lib/docs-nav";
import { ShellPageHeader } from "@/components/essential/layout/SitePageHeader";

import { seoMetadata } from "@/lib/seo/pages";
import { docsIndexJsonLd } from "@/lib/seo/jsonld";
import { JsonLd } from "@/components/essential/JsonLd";

/** Title, description, canonical address, and link previews: lib/seo/pages.ts. */
export const metadata: Metadata = seoMetadata("/docs");

const QUICK_LINKS = [
  { slug: "getting-started", title: "Quick start", body: "Account, first project, first compile." },
  { slug: "collaboration", title: "Collaboration", body: "Share a project and edit together in real time." },
  { slug: "keyboard-shortcuts", title: "Keyboard shortcuts", body: "Every shortcut in the editor." },
  { slug: "tikz-diagrams", title: "TikZ diagrams", body: "The library, the studio, and figures that compile." },
  { slug: "api", title: "API reference", body: "Base URL, auth, pagination, and every endpoint." },
  { slug: "self-hosting", title: "Self-hosting", body: "Run the whole stack on your own servers." },
];

export default function DocsOverviewPage() {
  return (
    <div>
      <JsonLd data={docsIndexJsonLd("/docs")} />
      <ShellPageHeader title="Documentation" description="Guides for converting, writing, reviewing, and building a project in Eneles, and a reference for every endpoint of the API. New to LaTeX itself? The lessons in Learn start from the first document."
        actions={
          <Link href="/learn" className="type-base font-medium underline underline-offset-4">
            Learn LaTeX
          </Link>
        } />

      <div className="grid gap-3 @min-[40rem]:grid-cols-2">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.slug}
            href={docHref(link.slug)}
            className="group rounded-[var(--radius-card)] border border-line bg-card p-5 transition-colors hover:border-foreground/25"
          >

            <p className="flex items-center gap-1.5 type-base font-semibold">
              {link.title}
              <ArrowRight
                className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                aria-hidden
              />
            </p>
            <p className="mt-1.5 type-base text-muted-foreground">
              {link.body}
            </p>
          </Link>
        ))}
      </div>

      <h2 className="mt-14 mb-4 text-xl font-semibold tracking-[-0.01em]">
        Everything
      </h2>

      {/* Each section is a table: the page and what it covers, in two columns, with a header row naming them. A row is the link. */}
      <div className="flex flex-col gap-10">
        {docsGroups.map((group) => {
          const items = group.items.filter((item) => item.slug !== "");
          if (items.length === 0) return null;
          return (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-3 type-large font-semibold">{group.title}</h3>
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
                <table className="w-full border-collapse text-start">
                  <thead className="bg-surface/50">
                    <tr className="border-b border-line">
                      <th scope="col" className="w-[38%] px-4 py-2.5 text-start type-small font-medium text-muted-foreground">
                        Page
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-start type-small font-medium text-muted-foreground">
                        What it covers
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {items.map((item) => (
                      <tr key={item.slug} className="group relative transition-colors hover:bg-surface/40">
                        <td className="px-4 py-3 align-top">
                          {/* The link covers the whole row. */}
                          <Link href={docHref(item.slug)} className="type-base font-medium after:absolute after:inset-0 after:content-['']">
                            {item.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 align-top type-base text-muted-foreground text-pretty">{item.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
