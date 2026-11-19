import Link from "next/link";
import { ArrowRight } from "@/components/icons";
import { ShellPageHeader } from "@/components/essential/layout/SitePageHeader";
import { learnTracks } from "@/lib/learn-nav";
import { seoMetadata } from "@/lib/seo/pages";
import { learnIndexJsonLd } from "@/lib/seo/jsonld";
import { JsonLd } from "@/components/essential/JsonLd";

/** Title, description, canonical address, and link previews: lib/seo/pages.ts. */
export const metadata = seoMetadata("/learn");

/** The Learn section's front page: every lesson, grouped by track and numbered in reading order. */
export default function LearnOverviewPage() {
  const tracks = learnTracks.filter((track) => track.lessons.length > 0);
  const total = tracks.reduce((n, track) => n + track.lessons.length, 0);

  return (
    <div>
      <JsonLd data={learnIndexJsonLd()} />
      <ShellPageHeader
        title="Learn LaTeX"
        description={`${total} short lessons, each with examples compiled on the page. Start at the top if LaTeX is new to you, or jump to what you need. For how Eneles itself works, see the docs.`}
        actions={
          <Link href="/docs" className="type-base font-medium underline underline-offset-4">
            Eneles docs
          </Link>
        }
      />

      {/* Each track is a set of cards in reading order: the lesson's number, its title, and what it teaches. */}
      <div className="flex flex-col gap-14">
        {tracks.map((track) => (
          <section key={track.id} aria-labelledby={`track-${track.id}`}>
            <div className="flex items-baseline justify-between gap-4">
              <h2 id={`track-${track.id}`} className="text-xl font-semibold tracking-[-0.01em]">
                {track.title}
              </h2>
              <span className="shrink-0 type-small text-muted-foreground tabular-nums">
                {track.lessons.length} {track.lessons.length === 1 ? "lesson" : "lessons"}
              </span>
            </div>
            {track.description && <p className="mt-1 type-base text-muted-foreground text-pretty">{track.description}</p>}
            <ol className="mt-5 grid gap-3 @min-[46rem]:grid-cols-2">
              {track.lessons.map((lesson, i) => (
                <li key={lesson.slug} className="min-w-0">
                  <Link href={`/learn/${lesson.slug}`} className="group flex h-full flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-card p-4 transition-colors hover:border-foreground/25">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-mono type-small text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                      <ArrowRight aria-hidden className="size-4 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100 rtl:-scale-x-100" />
                    </span>
                    <span className="type-base font-semibold">{lesson.title}</span>
                    <span className="type-base text-muted-foreground text-pretty">{lesson.description}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
