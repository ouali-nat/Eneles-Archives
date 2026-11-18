import learnManifest from "@/content/learn.json";
import type { DocGroup } from "@/lib/docs-nav";
import type { LearnTrack } from "@/lib/learn/types";

/** The LaTeX lessons, in the order they are meant to be read. The tracks, their order, and each lesson's title and search terms come from the learn repository (its nav.json and each lesson's frontmatter), copied in by scripts/sync-content.mjs. */
export const learnTracks: LearnTrack[] = (learnManifest as { tracks: LearnTrack[] }).tracks;

/** The Learn section's sidebar: an overview, then one group per track. */
export const learnGroups: DocGroup[] = [
  {
    title: "Learn LaTeX",
    items: [{ slug: "", title: "Overview", description: "Every lesson, by track.", keywords: ["lessons", "tutorial", "latex", "index"], builtIn: true }],
  },
  ...learnTracks
    .filter((track) => track.lessons.length > 0)
    .map((track) => ({ title: track.title, items: track.lessons.map((lesson) => ({ ...lesson })) })),
];
