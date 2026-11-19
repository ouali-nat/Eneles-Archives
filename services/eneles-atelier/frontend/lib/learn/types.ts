/** One LaTeX lesson, as the Learn section's navigation and search list it. */
export interface LearnLesson {
  /** The page's path after /learn/. Unique across every track. */
  slug: string;
  title: string;
  /** One sentence, shown in the track's listing and in search results. */
  description: string;
  /** A longer description, 120 to 160 characters, for search results and link previews. Falls back to the description. */
  summary?: string;
  /** Extra search terms that are not in the title: command names, synonyms. */
  keywords?: string[];
}

/** A group of lessons read in order. */
export interface LearnTrack {
  id: string;
  title: string;
  /** One sentence on what the track covers. */
  description: string;
  lessons: LearnLesson[];
}
