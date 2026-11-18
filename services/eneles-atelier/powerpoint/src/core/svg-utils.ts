// SVG <-> raster helpers. PowerPoint's Office.js Image coercion type
// (Office.CoercionType.Image) is the reliable, battle-tested way to insert
// a picture into a slide across every PowerPoint version; the SVG coercion
// type (Office.CoercionType.XmlSvg) has a known distortion bug in some
// hosts (see OfficeDev/office-js#4967), so it's offered as an opt-in
// "experimental" path in the UI rather than the default.
//
// The strategy: keep the real vector SVG as the source of truth (available
// to copy/download), and rasterize it on demand to a PNG at whatever pixel
// size the caller wants, sized generously (rasterScale in Settings) so it
// stays crisp even if resized somewhat on the slide afterwards.

export const CSS_PX_PER_INCH = 96;
export const POINTS_PER_INCH = 72;

// Canvas ceilings. Browsers cap both the longest edge and the total pixel
// count, and exceeding either yields a blank image rather than an error.
const MAX_RASTER_EDGE_PX = 8192;
const MAX_RASTER_PIXELS = 24_000_000;

export interface SvgAspectRatio {
  width: number;
  height: number;
}

/** Reads the aspect ratio from a viewBox (preferred) or width/height attributes. */
export function getSvgAspectRatio(svgString: string): SvgAspectRatio {
  const viewBoxMatch = svgString.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const widthMatch = svgString.match(/<svg[^>]*\swidth\s*=\s*"([\d.]+)/i);
  const heightMatch = svgString.match(/<svg[^>]*\sheight\s*=\s*"([\d.]+)/i);
  const width = widthMatch ? parseFloat(widthMatch[1]) : 100;
  const height = heightMatch ? parseFloat(heightMatch[1]) : 100;
  return { width: width || 100, height: height || 100 };
}

export interface RasterSize {
  widthPx: number;
  heightPx: number;
  widthPt: number;
  heightPt: number;
}

/**
 * Given a desired physical width (inches) and a crispness multiplier,
 * compute both the raster (px) and Office insertion (pt) sizes.
 *
 * The pixel dimensions are capped independently of the point dimensions:
 * a wide box at a high raster scale can otherwise ask for a canvas of tens
 * of millions of pixels, which browsers refuse to allocate (silently
 * producing a blank image). Clamping only the raster side means an
 * oversized request loses some sharpness instead of failing outright,
 * while still being inserted at the physical size that was asked for.
 */
export function computeRasterSize(svgString: string, widthInches: number, scale: number): RasterSize {
  const { width, height } = getSvgAspectRatio(svgString);
  const aspect = height > 0 ? width / height : 1;
  const widthPt = widthInches * POINTS_PER_INCH;
  const heightPt = widthPt / aspect;

  let widthPx = Math.max(1, Math.round(widthInches * CSS_PX_PER_INCH * scale));
  let heightPx = Math.max(1, Math.round(widthPx / aspect));

  const shrink = Math.min(
    1,
    MAX_RASTER_EDGE_PX / Math.max(widthPx, heightPx),
    Math.sqrt(MAX_RASTER_PIXELS / (widthPx * heightPx)),
  );
  if (shrink < 1) {
    widthPx = Math.max(1, Math.floor(widthPx * shrink));
    heightPx = Math.max(1, Math.floor(heightPx * shrink));
  }

  return { widthPx, heightPx, widthPt, heightPt };
}

/** Rasterizes an SVG string to a PNG. Returns both a data URL (for <img> previews) and the raw base64 (for Office.js, which wants no `data:` prefix). */
export function svgToPng(
  svgString: string,
  widthPx: number,
  heightPx: number,
  opts: { backgroundColor?: string } = {},
): Promise<{ dataUrl: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context unavailable");

        if (opts.backgroundColor) {
          ctx.fillStyle = opts.backgroundColor;
          ctx.fillRect(0, 0, widthPx, heightPx);
        }
        ctx.drawImage(img, 0, 0, widthPx, heightPx);

        const dataUrl = canvas.toDataURL("image/png");
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
        resolve({ dataUrl, base64 });
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to rasterize SVG (it may reference something the browser refused to load)."));
    };
    img.src = url;
  });
}

export function svgToDownloadUrl(svgString: string): string {
  return URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));
}

export interface SvgLook {
  /** Ink color baked into fills. Skip for diagrams that already have their own colors. */
  color?: string;
  /** Uniform size multiplier (1 = 100%). */
  scale: number;
  /** Extra horizontal tracking, in percent. 0 is unchanged. */
  spacing: number;
  /** Target CSS pixel width written onto the root <svg>. PowerPoint uses this as the shape size. */
  widthPx: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

function parseSvgRoot(svgString: string): SVGSVGElement | null {
  const trimmed = svgString.replace(/^\uFEFF/, "").trim();
  const asXml = new DOMParser().parseFromString(trimmed, "image/svg+xml");
  const xmlRoot = asXml.documentElement;
  if (xmlRoot && xmlRoot.tagName.toLowerCase() === "svg" && !asXml.querySelector("parsererror")) {
    return xmlRoot as unknown as SVGSVGElement;
  }
  const asHtml = new DOMParser().parseFromString(trimmed, "text/html");
  return asHtml.querySelector("svg");
}

function hrefOf(use: Element): string | null {
  return (
    use.getAttribute("href") ||
    use.getAttribute("xlink:href") ||
    use.getAttributeNS(XLINK_NS, "href")
  );
}

function inlineUses(svg: SVGSVGElement): void {
  const uses = Array.from(svg.querySelectorAll("use"));
  for (const use of uses) {
    const href = hrefOf(use);
    if (!href || !href.startsWith("#")) continue;
    const id = href.slice(1);
    const target =
      svg.ownerDocument.getElementById(id) ||
      svg.querySelector(`[id="${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
    if (!target) continue;
    const clone = materializeUseTarget(svg, target);
    const x = parseFloat(use.getAttribute("x") || "0") || 0;
    const y = parseFloat(use.getAttribute("y") || "0") || 0;
    const parent = use.parentNode;
    if (!parent) continue;
    if (x || y) {
      const g = svg.ownerDocument.createElementNS(SVG_NS, "g");
      g.setAttribute("transform", `translate(${x},${y})`);
      copyPaint(use, g);
      g.appendChild(clone);
      parent.replaceChild(g, use);
    } else {
      copyPaint(use, clone);
      parent.replaceChild(clone, use);
    }
  }
  for (const defs of Array.from(svg.querySelectorAll("defs"))) {
    if (!defs.childElementCount) defs.remove();
  }
}

// Attributes that only mean something on <symbol>/<marker> and would be
// meaningless (or actively wrong) once the node is re-tagged as a <g>.
const SYMBOL_ONLY_ATTRS = new Set([
  "id",
  "overflow",
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "refX",
  "refY",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "orient",
]);

/**
 * Clones a <use> target into something that actually paints where it lands.
 *
 * This is load-bearing: pdftocairo (the fallback converter we end up on,
 * because dvisvgm is broken against Ghostscript >= 10.01) emits EVERY glyph
 * as a <symbol> definition plus a <use> that instantiates it. A <symbol>
 * only renders through <use>. Dropped into the tree directly it paints
 * nothing at all. Cloning it verbatim therefore deleted every character of
 * text while leaving the box art intact, which is exactly the "renders but
 * the text doesn't show" symptom. Re-tag it as a <g>, which renders in
 * place and inherits fill from the ancestor group cairo already wrote.
 */
function materializeUseTarget(svg: SVGSVGElement, target: Element): Element {
  const clone = target.cloneNode(true) as Element;
  const tag = clone.tagName.toLowerCase();
  if (tag !== "symbol" && tag !== "marker") {
    clone.removeAttribute("id");
    return clone;
  }

  const group = svg.ownerDocument.createElementNS(SVG_NS, "g");
  for (const attr of Array.from(clone.attributes)) {
    if (SYMBOL_ONLY_ATTRS.has(attr.name)) continue;
    group.setAttribute(attr.name, attr.value);
  }
  while (clone.firstChild) group.appendChild(clone.firstChild);
  return group;
}

function copyPaint(from: Element, to: Element): void {
  for (const name of ["fill", "stroke", "stroke-width", "transform"]) {
    const value = from.getAttribute(name);
    if (value && !to.getAttribute(name)) to.setAttribute(name, value);
  }
}

function bakeColor(svg: SVGSVGElement, color: string): void {
  const walk = (el: Element) => {
    const style = el.getAttribute("style");
    if (style && /currentColor/i.test(style)) {
      el.setAttribute("style", style.replace(/currentColor/gi, color));
    }
    for (const name of ["fill", "stroke"]) {
      const value = el.getAttribute(name);
      if (value && /currentColor/i.test(value)) el.setAttribute(name, color);
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(svg);
  if (!svg.getAttribute("fill")) svg.setAttribute("fill", color);
  svg.querySelectorAll("path, rect, circle, ellipse, polygon, polyline").forEach((el) => {
    if (!el.getAttribute("fill")) el.setAttribute("fill", color);
  });
}

function stripUnsupported(svg: SVGSVGElement): void {
  svg.querySelectorAll("script, foreignObject, style").forEach((node) => node.remove());
  for (const name of ["role", "focusable", "aria-hidden", "aria-label", "xmlns:xlink"]) {
    svg.removeAttribute(name);
  }
  svg.removeAttribute("style");
  svg.removeAttributeNS("http://www.w3.org/2000/xmlns/", "xlink");
}

/**
 * PowerPoint's SVG importer rejects MathJax output (ex units, currentColor, <use>).
 * This flattens the markup into something the host can actually paint.
 */
export function prepareSvgForOffice(svgString: string, look: SvgLook): string {
  const svg = parseSvgRoot(svgString);
  if (!svg) return svgString;

  for (let i = 0; i < 8 && svg.querySelector("use"); i++) inlineUses(svg);
  if (!svg.querySelector("use")) {
    svg.querySelectorAll("defs").forEach((node) => node.remove());
  }
  if (look.color) bakeColor(svg, look.color);
  stripUnsupported(svg);

  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("version", "1.1");

  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && (parts[0] !== 0 || parts[1] !== 0)) {
      const wrapper = svg.ownerDocument.createElementNS(SVG_NS, "g");
      wrapper.setAttribute("transform", `translate(${-parts[0]},${-parts[1]})`);
      while (svg.firstChild) wrapper.appendChild(svg.firstChild);
      svg.appendChild(wrapper);
      svg.setAttribute("viewBox", `0 0 ${parts[2]} ${parts[3]}`);
    }
  }

  svg.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith("data-") || attr.name.startsWith("aria-")) {
        node.removeAttribute(attr.name);
      }
    }
  });

  const aspect = getSvgAspectRatio(new XMLSerializer().serializeToString(svg));
  const widthPx = Math.max(1, Math.round(look.widthPx * look.scale));
  const heightPx = Math.max(1, Math.round(widthPx * (aspect.height / (aspect.width || 1))));

  const track = 1 + look.spacing / 100;
  if (track !== 1) {
    const wrapper = svg.ownerDocument.createElementNS(SVG_NS, "g");
    wrapper.setAttribute("transform", `scale(${track},1)`);
    while (svg.firstChild) wrapper.appendChild(svg.firstChild);
    svg.appendChild(wrapper);
    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const parts = vb.trim().split(/\s+/).map(Number);
      if (parts.length === 4) {
        parts[2] *= track;
        svg.setAttribute("viewBox", parts.join(" "));
      }
    }
  }

  svg.setAttribute("width", String(widthPx));
  svg.setAttribute("height", String(heightPx));

  let out = new XMLSerializer().serializeToString(svg);
  out = out.replace(/\s+xmlns:NS\d+="[^"]*"/g, "").replace(/\s+NS\d+:/g, " ");
  if (look.color) out = out.replace(/currentColor/gi, look.color);
  if (!/^<svg[\s>]/i.test(out) && out.includes("<svg")) {
    out = out.slice(out.indexOf("<svg"));
  }
  return out;
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
