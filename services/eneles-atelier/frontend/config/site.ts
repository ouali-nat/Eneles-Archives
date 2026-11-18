import { SITE_URL } from "@/lib/site-urls";

const FORGE = process.env.NEXT_PUBLIC_FORGE_URL?.replace(/\/+$/, "") || "https://github.com/ouali-nat/Eneles-Archives";

export const siteConfig = {
  name: "Eneles Atelier",
  url: SITE_URL,
  // Drawn by app/og/[...path]/route.tsx, in the same look as the cards for Docs, Learn, and the Library.
  ogImage: `${SITE_URL}/og/site`,
  description:
    "L’atelier scientifique Eneles : éditeur LaTeX, compilation PDF, collaboration, bibliothèque TikZ, références, conversions et synchronisation. Toutes les fonctionnalités sont accessibles sans abonnement.",
  links: {
    /** The mirror on GitHub. */
    github: "https://github.com/ouali-nat/Eneles-Archives",
    /** Our own Git server (Forgejo, ops/forgejo/README.md), where the source lives. NEXT_PUBLIC_FORGE_URL overrides it for a self-hosted copy. */
    forge: FORGE,
    /** The Eneles organization on it: every repository. */
    source: FORGE,
  },
  contact: {
    sales: "/contact",
    support: "/contact",
  },
}

export type SiteConfig = typeof siteConfig
