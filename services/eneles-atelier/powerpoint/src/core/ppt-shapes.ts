// Re-editing, re-rendering and numbering via the PowerPoint shape API.
//
// Office.js can only *insert* a picture at the selection (office-insert.ts).
// Everything here works on the picture afterwards: tagging it with its
// LaTeX source, finding tagged pictures, and swapping one for a new render
// in place. It needs PowerPointApi 1.5 (selection + slides; tags, delete
// and geometry are 1.3), i.e. a current Microsoft 365 PowerPoint. On older
// builds `shapeApiSupported()` is false and the pane hides these features.
//
// impress/'s insert.py is the LibreOffice equivalent.

import { ShapeMeta } from "./types";

const TAG = "TEXER_META";

export function shapeApiSupported(): boolean {
  try {
    return (
      typeof PowerPoint !== "undefined" &&
      !!Office.context?.requirements?.isSetSupported("PowerPointApi", "1.5")
    );
  } catch {
    return false;
  }
}

function altTextSupported(): boolean {
  try {
    return !!Office.context.requirements.isSetSupported("PowerPointApi", "1.10");
  } catch {
    return false;
  }
}

export interface TexerShape {
  slideId: string;
  shapeId: string;
  meta: ShapeMeta;
  left: number;
  top: number;
  width: number;
  height: number;
}

function parseMeta(value: string | undefined | null): ShapeMeta | null {
  if (!value) return null;
  try {
    const meta = JSON.parse(value) as ShapeMeta;
    return meta && typeof meta.source === "string" ? meta : null;
  } catch {
    return null;
  }
}

/** Tags the currently selected shape (the picture just inserted) with its source. */
export async function tagSelected(meta: ShapeMeta): Promise<void> {
  await PowerPoint.run(async (ctx) => {
    const shapes = ctx.presentation.getSelectedShapes();
    shapes.load("items");
    await ctx.sync();
    if (shapes.items.length !== 1) return;
    const shape = shapes.items[0];
    shape.tags.add(TAG, JSON.stringify(meta));
    shape.name = `Eneles ${meta.workspace}`;
    if (altTextSupported()) {
      // The LaTeX source is decent alt text, and it survives other apps.
      shape.altTextTitle = "Eneles";
      shape.altTextDescription = meta.source;
    }
    await ctx.sync();
  });
}

/** The selected Eneles picture, if exactly one is selected. */
export async function getSelectedTexer(): Promise<TexerShape | null> {
  return PowerPoint.run(async (ctx) => {
    const shapes = ctx.presentation.getSelectedShapes();
    shapes.load("items");
    await ctx.sync();
    if (shapes.items.length !== 1) return null;
    const shape = shapes.items[0];
    const tag = shape.tags.getItemOrNullObject(TAG);
    tag.load("value");
    shape.load("id,left,top,width,height");
    const slide = shape.getParentSlide();
    slide.load("id");
    await ctx.sync();
    const meta = tag.isNullObject ? null : parseMeta(tag.value);
    if (!meta) return null;
    return { slideId: slide.id, shapeId: shape.id, meta, left: shape.left, top: shape.top, width: shape.width, height: shape.height };
  });
}

/** Every Eneles picture in the presentation, slide by slide. */
export async function listTexerShapes(): Promise<TexerShape[]> {
  return PowerPoint.run(async (ctx) => {
    const slides = ctx.presentation.slides;
    slides.load("items/id");
    await ctx.sync();
    const perSlide = slides.items.map((slide) => {
      const shapes = slide.shapes;
      shapes.load("items/id,items/left,items/top,items/width,items/height");
      return { slide, shapes };
    });
    await ctx.sync();
    const tags: { slideId: string; shape: PowerPoint.Shape; tag: PowerPoint.Tag }[] = [];
    for (const { slide, shapes } of perSlide) {
      for (const shape of shapes.items) {
        const tag = shape.tags.getItemOrNullObject(TAG);
        tag.load("value");
        tags.push({ slideId: slide.id, shape, tag });
      }
    }
    await ctx.sync();
    const out: TexerShape[] = [];
    for (const { slideId, shape, tag } of tags) {
      const meta = tag.isNullObject ? null : parseMeta(tag.value);
      if (meta) {
        out.push({ slideId, shapeId: shape.id, meta, left: shape.left, top: shape.top, width: shape.width, height: shape.height });
      }
    }
    return out;
  });
}

/** Numbers already used by boxes with this label, anywhere in the presentation. */
export async function boxNumbers(label: string, excludeShapeId?: string): Promise<string[]> {
  const all = await listTexerShapes();
  return all
    .filter((s) => s.shapeId !== excludeShapeId && s.meta.workspace === "boxes" && s.meta.box?.label === label)
    .map((s) => s.meta.box?.number || "");
}

/**
 * Swaps `old` for a new render in place.
 *
 * `insert` must put the new picture on the current slide (Office.js leaves a
 * freshly inserted picture selected). The old shape is removed first, then
 * the new one is moved to the old position and scaled by the same factor
 * the user had resized the old one by, so tweaking the source doesn't undo
 * layout work. Finally the new picture is tagged.
 */
export async function replaceShape(
  old: TexerShape,
  meta: ShapeMeta,
  insert: () => Promise<{ widthPt: number; heightPt: number }>,
): Promise<void> {
  await PowerPoint.run(async (ctx) => {
    ctx.presentation.setSelectedSlides([old.slideId]);
    ctx.presentation.slides.getItem(old.slideId).shapes.getItem(old.shapeId).delete();
    await ctx.sync();
  });

  const inserted = await insert();
  const ratio = old.meta.insertedWidth ? old.width / old.meta.insertedWidth : 1;

  await PowerPoint.run(async (ctx) => {
    const shapes = ctx.presentation.getSelectedShapes();
    shapes.load("items");
    await ctx.sync();
    if (shapes.items.length !== 1) return;
    const shape = shapes.items[0];
    shape.left = old.left;
    shape.top = old.top;
    shape.width = inserted.widthPt * ratio;
    shape.height = inserted.heightPt * ratio;
    await ctx.sync();
  });
  await tagSelected({ ...meta, insertedWidth: inserted.widthPt });
}
