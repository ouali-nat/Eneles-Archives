import Link from "next/link";
import { siteConfig } from "@/config/site";
import { BrandMarks } from "@/components/BrandMarks";
import { Mail } from "@/components/icons";
import { ModeToggle } from "./ModeToggle";
import { WelcomeMat } from "./WelcomeMat";

const columns: { title: string; links: { title: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { title: "Features", href: "/features" },
      { title: "Pricing", href: "/pricing" },
      { title: "TikZ library", href: "/library" },
      { title: "Templates", href: "/library/templates" },
      { title: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Guides",
    links: [
      { title: "Learn LaTeX", href: "/learn" },
      { title: "Getting started", href: "/docs/getting-started" },
      { title: "Collaboration", href: "/docs/collaboration" },
      { title: "TikZ diagrams", href: "/docs/tikz-diagrams" },
      { title: "Keyboard shortcuts", href: "/docs/keyboard-shortcuts" },
    ],
  },
  {
    title: "Developers",
    links: [
      { title: "Documentation", href: "/docs" },
      { title: "REST API", href: "/docs/api" },
      { title: "Self-hosting", href: "/docs/self-hosting" },
      { title: "Contribute", href: "/contribute" },
    ],
  },
  {
    title: "Company",
    links: [
      { title: "About", href: "/about" },
      { title: "Contact", href: "/contact" },
      { title: "Source code", href: siteConfig.links.source, external: true },
    ],
  },
];

const legal = [
  { title: "Privacy", href: "/privacy" },
  { title: "Terms", href: "/terms" },
  { title: "Refunds", href: "/refunds" },
];

export function SiteFooter() {
  return (
    <footer data-marketing className="@container/footer">
      <div className="container flex flex-col gap-14 pt-16 pb-10 @3xl/footer:pt-20">
        <div className="grid gap-12 @5xl/footer:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] @5xl/footer:gap-16">
          <div className="flex flex-col items-start gap-4">
            <Link href="/" aria-label="Eneles home">
              <BrandMarks.logo className="h-5 w-auto fill-foreground" />
            </Link>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The LaTeX workspace for the whole paper: convert, write, draw, review, and build, together.
            </p>
            <div className="-ms-2 flex items-center gap-1">
              <Link
                href={siteConfig.links.source}
                target="_blank"
                rel="noreferrer"
                aria-label="Source code on GitHub Eneles"
                title="Source code on GitHub Eneles"
                className="inline-flex size-[var(--control-height)] items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <BrandMarks.forgejo className="size-4" />
              </Link>
              <Link
                href={siteConfig.links.github}
                target="_blank"
                rel="noreferrer"
                aria-label="Eneles on GitHub"
                title="Eneles on GitHub"
                className="inline-flex size-[var(--control-height)] items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <BrandMarks.gitHub className="size-4" />
              </Link>
              <a
                href={siteConfig.contact.support}
                aria-label="Write to support"
                title="Write to support"
                className="inline-flex size-[var(--control-height)] items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <Mail className="size-4" />
              </a>
            </div>
          </div>

          <nav aria-label="Site" className="grid grid-cols-2 gap-x-6 gap-y-10 @min-[40rem]/footer:grid-cols-3 @5xl/footer:grid-cols-4">
            {columns.map((column) => (
              <div key={column.title} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">{column.title}</h2>
                <ul className="flex flex-col gap-2.5">
                  {column.links.map((l) => (
                    <li key={l.title}>
                      <Link
                        href={l.href}
                        {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {l.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-4 border-t border-line pt-6 text-xs text-muted-foreground @min-[40rem]/footer:flex-row @min-[40rem]/footer:items-center @min-[40rem]/footer:justify-between">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1" suppressHydrationWarning>
            <span>&copy; {new Date().getFullYear()} {siteConfig.name}</span>
            <span>Built by academics, for academics</span>
          </p>
          <div className="flex items-center gap-3">
            <ModeToggle />
            <nav aria-label="Legal" className="flex items-center gap-4">
              {legal.map((l) => (
                <Link key={l.href} href={l.href} className="transition-colors hover:text-foreground">
                  {l.title}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
      <WelcomeMat />
    </footer>
  );
}
