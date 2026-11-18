/* eslint-disable texer/token-styles -- next/og draws from inline styles only; there are no classes or tokens to use here (see below). */
import { ImageResponse } from "next/og";
import { BrandMarks } from "@/components/BrandMarks";
import { SECTION_NAMES, seoPage } from "@/lib/seo/pages";
import { SITE_URL } from "@/lib/site-urls";

/**
 * The link-preview image for every Docs, Learn, and Library page: /og/docs/compiling is the image for /docs/compiling. One generator for all three sections, so the cards look alike; the page's title and section come from lib/seo/pages.ts, and an address that is not a page answers 404, so the route cannot be used to draw arbitrary text.
 *
 * Literal colors, unlike everywhere else on the site: the image is drawn by a renderer that cannot read the site's CSS tokens. These are the dark theme's values from app/globals.css (background, foreground, muted foreground, line).
 */
const BACKGROUND = "#141414";
const FOREGROUND = "#f5f5f5";
const MUTED = "#a3a3a3";
const LINE = "#3a3a3a";

const size = { width: 1200, height: 630 };

// Each image is drawn on its first request and then served from the cache until the next deploy.
export const dynamic = "force-static";

export function generateStaticParams() {
  return [];
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const address = `/${(await params).path.join("/")}`;
  // /og/site is the card for every page outside the three sections (the home page, pricing, and the rest): the wordmark and what Eneles is.
  if (address === "/site") return card({ corner: "", kicker: "Write, review, cite, and build", title: "The LaTeX workspace for the whole paper", foot: new URL(SITE_URL).host });
  const page = seoPage(address);
  if (!page) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  // The section is in the corner; above the title goes what kind of page this is within it.
  const kicker = page.kind === "package" ? `TikZ package · ${page.group}` : page.kind === "example" ? `${page.group} example` : page.kind === "template" ? `LaTeX template · ${page.group}` : (page.group ?? "");
  return card({ corner: SECTION_NAMES[page.section], kicker, title: page.name, foot: `${new URL(SITE_URL).host}${page.path}` });
}

/** One card: the wordmark and a corner label, a line above the title, the title, and the address along the foot. */
function card({ corner, kicker, title, foot }: { corner: string; kicker: string; title: string; foot: string }) {
  const titleSize = title.length > 48 ? 64 : title.length > 28 ? 76 : 92;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "72px 80px", background: BACKGROUND, color: FOREGROUND }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <BrandMarks.logo style={{ width: 200, height: 60, color: FOREGROUND }} />
          <div style={{ display: "flex", fontSize: 28, color: MUTED }}>{corner}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "flex-end" }}>
          {kicker && <div style={{ display: "flex", fontSize: 30, color: MUTED, marginBottom: 20 }}>{kicker}</div>}
          <div style={{ display: "flex", fontSize: titleSize, lineHeight: 1.08, letterSpacing: "-0.02em", maxWidth: 1040 }}>{title}</div>
        </div>
        <div style={{ display: "flex", marginTop: 48, paddingTop: 28, borderTop: `2px solid ${LINE}`, fontSize: 26, color: MUTED }}>{foot}</div>
      </div>
    ),
    { ...size, headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } },
  );
}
