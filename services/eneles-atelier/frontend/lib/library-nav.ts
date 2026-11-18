import { tikzLibraries, type TikzExample } from "@/lib/tikz/libraries";
import {
  LATEX_TEMPLATES,
  LATEX_TEMPLATE_CATEGORIES,
  type LaTeXTemplate,
} from "@/lib/latex/templates";

/**
 * Flat navigation model for the library browser.
 *
 * The browser is a two-level tree (package, then its examples) rendered as a
 * persistent sidebar, so moving between examples is one click instead of the
 * old index → package → example → back → back round trip. Everything the
 * sidebar, the search, and the prev/next controls need is derived here, so they
 * cannot disagree about ordering.
 */

export interface LibraryEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  ctanUrl: string;
  /** A family of our own rather than a package on CTAN (see TikzLibrary). */
  custom?: boolean;
  examples: TikzExample[];
}

export const libraryEntries: LibraryEntry[] = tikzLibraries.map((lib) => ({
  id: lib.id,
  name: lib.name,
  description: lib.description,
  category: lib.category,
  ctanUrl: lib.ctanUrl,
  custom: lib.custom,
  examples: lib.examples,
}));

export const templateEntries = LATEX_TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  category: t.category,
}));

/**
 * Templates grouped by category, mirroring the package tree.
 *
 * Empty categories are dropped rather than rendered as empty rows, so the tree
 * stays honest while the template set grows into it.
 */
export interface TemplateGroup {
  category: string;
  templates: LaTeXTemplate[];
}

export const templateGroups: TemplateGroup[] = LATEX_TEMPLATE_CATEGORIES.map(
  (category) => ({
    category,
    templates: LATEX_TEMPLATES.filter((t) => t.category === category),
  }),
).filter((group) => group.templates.length > 0);

export function templateHref(templateId: string): string {
  return `/library/templates/${templateId}`;
}

/** Every template in sidebar order, for prev/next across category boundaries. */
export const flatTemplates = templateGroups.flatMap((group) =>
  group.templates.map((t) => ({
    id: t.id,
    name: t.name,
    category: group.category,
  })),
);

export function getAdjacentTemplates(templateId: string) {
  const idx = flatTemplates.findIndex((t) => t.id === templateId);
  if (idx === -1) return {};
  return {
    prev: idx > 0 ? flatTemplates[idx - 1] : undefined,
    next: idx < flatTemplates.length - 1 ? flatTemplates[idx + 1] : undefined,
  };
}

export function libraryHref(libraryId: string): string {
  return `/library/${libraryId}`;
}

export function exampleHref(libraryId: string, exampleId: string): string {
  return `/library/${libraryId}/${exampleId}`;
}

/** Every example in sidebar order, for prev/next across package boundaries. */
export interface FlatExample {
  libraryId: string;
  libraryName: string;
  exampleId: string;
  exampleName: string;
}

export const flatExamples: FlatExample[] = libraryEntries.flatMap((lib) =>
  lib.examples.map((ex) => ({
    libraryId: lib.id,
    libraryName: lib.name,
    exampleId: ex.id,
    exampleName: ex.name,
  })),
);

export function getAdjacentExamples(libraryId: string, exampleId: string) {
  const idx = flatExamples.findIndex(
    (e) => e.libraryId === libraryId && e.exampleId === exampleId,
  );
  if (idx === -1) return {};
  return {
    prev: idx > 0 ? flatExamples[idx - 1] : undefined,
    next: idx < flatExamples.length - 1 ? flatExamples[idx + 1] : undefined,
  };
}

export const totalExampleCount = flatExamples.length;
