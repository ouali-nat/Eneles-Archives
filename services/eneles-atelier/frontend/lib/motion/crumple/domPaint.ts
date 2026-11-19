/* A minimal painter of a sheet's DOM into a transparent 2D canvas, so the content can ride on the paper while it moves. It is our own walk of the face's boxes, not a foreignObject (which taints canvases in Safari) and not html2canvas: positions come from getBoundingClientRect relative to the face (divided by any ancestor scale), and it draws background colors (rounded by their corner radii), solid, dashed, and dotted borders, text word by word at its own baseline with the computed font, color, letter spacing, case transform, and underline or line-through, complete images (honoring object-fit and object-position), canvases, and inline SVG (serialized with its color resolved). Opacity multiplies down the tree and overflow other than visible clips to the box.

It skips display: none, visibility: hidden, and visually hidden boxes (the 1px clip patterns, such as KaTeX's MathML copy), so KaTeX paints from its visual spans. It does not paint gradients, shadows, transforms, filters, pseudo-element content, list markers, or form controls; `face="overlay"` is the escape hatch for content that needs them. If an image taints the canvas (cross-origin without CORS), the caller repaints without images. */

export type PaintResult = { tainted: boolean };

type Box = { x: number; y: number; w: number; h: number };

const transparent = (value: string) => !value || value === "transparent" || /rgba\([^)]*,\s*0\)$/.test(value) || /\/\s*0\)$/.test(value);

function radius(value: string, box: Box): number {
  const first = value.split(" ")[0] ?? "0";
  const number = Number.parseFloat(first);
  if (!Number.isFinite(number)) return 0;
  const resolved = first.endsWith("%") ? (number / 100) * Math.min(box.w, box.h) : number;
  return Math.max(0, Math.min(resolved, box.w / 2, box.h / 2));
}

function roundedPath(context: CanvasRenderingContext2D, box: Box, radii: [number, number, number, number]) {
  context.beginPath();
  if (radii.some((r) => r > 0) && typeof context.roundRect === "function") context.roundRect(box.x, box.y, box.w, box.h, radii);
  else context.rect(box.x, box.y, box.w, box.h);
}

function hidden(style: CSSStyleDeclaration, box: Box): boolean {
  if (style.visibility === "hidden" || style.visibility === "collapse") return true;
  const clip = style.clip;
  if (clip && clip !== "auto" && /rect\(/.test(clip)) return true;
  if (style.clipPath && /^inset\(\s*50%/.test(style.clipPath)) return true;
  if (box.w <= 1 && box.h <= 1 && (style.overflow === "hidden" || style.overflowX === "hidden")) return true;
  return false;
}

const transform = (text: string, mode: string) => {
  if (mode === "uppercase") return text.toUpperCase();
  if (mode === "lowercase") return text.toLowerCase();
  if (mode === "capitalize") return text.replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
  return text;
};

function graphemes(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) out.push({ text: part.segment, start: part.index, end: part.index + part.segment.length });
    return out;
  }
  let at = 0;
  for (const character of Array.from(text)) {
    out.push({ text: character, start: at, end: at + character.length });
    at += character.length;
  }
  return out;
}

/* The fit of an image's natural size into a box by object-fit and object-position. */
function fitImage(natural: { w: number; h: number }, box: Box, fit: string, position: string): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const full = { sx: 0, sy: 0, sw: natural.w, sh: natural.h, dx: box.x, dy: box.y, dw: box.w, dh: box.h };
  if (fit === "fill" || !natural.w || !natural.h) return full;
  const [px, py] = position.split(" ").map((part) => (part.endsWith("%") ? Number.parseFloat(part) / 100 : 0.5));
  const fx = Number.isFinite(px) ? px : 0.5;
  const fy = Number.isFinite(py) ? py : 0.5;
  const ratio = fit === "cover" ? Math.max(box.w / natural.w, box.h / natural.h) : fit === "none" ? 1 : Math.min(box.w / natural.w, box.h / natural.h, fit === "scale-down" ? 1 : Infinity);
  const dw = natural.w * ratio;
  const dh = natural.h * ratio;
  if (fit === "cover") {
    const sw = box.w / ratio;
    const sh = box.h / ratio;
    return { sx: (natural.w - sw) * fx, sy: (natural.h - sh) * fy, sw, sh, dx: box.x, dy: box.y, dw: box.w, dh: box.h };
  }
  return { sx: 0, sy: 0, sw: natural.w, sh: natural.h, dx: box.x + (box.w - dw) * fx, dy: box.y + (box.h - dh) * fy, dw, dh };
}

function svgImage(svg: SVGSVGElement, style: CSSStyleDeclaration, box: Box): Promise<HTMLImageElement | null> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(box.w));
  copy.setAttribute("height", String(box.h));
  if (!transparent(style.fill) && style.fill !== "none") copy.setAttribute("fill", style.fill);
  if (style.stroke && style.stroke !== "none") copy.setAttribute("stroke", style.stroke);
  const markup = new XMLSerializer().serializeToString(copy).replace(/currentColor/g, style.color);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

export async function paintFace(face: HTMLElement, canvas: HTMLCanvasElement, scale: number, { images = true }: { images?: boolean } = {}): Promise<PaintResult> {
  const context = canvas.getContext("2d");
  if (!context) return { tainted: false };
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const origin = face.getBoundingClientRect();
  const zoom = face.offsetWidth > 0 ? origin.width / face.offsetWidth : 1;
  const local = (rect: DOMRect): Box => ({ x: (rect.left - origin.left) / zoom, y: (rect.top - origin.top) / zoom, w: rect.width / zoom, h: rect.height / zoom });
  const range = document.createRange();
  const pending: Promise<void>[] = [];
  const spaced = "letterSpacing" in context;

  const paintText = (node: Text, style: CSSStyleDeclaration, opacity: number) => {
    const data = node.data;
    if (!data.trim()) return;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.fillStyle = style.color;
    context.globalAlpha = opacity;
    context.textBaseline = "alphabetic";
    context.textAlign = "left";
    context.direction = style.direction === "rtl" ? "rtl" : "ltr";
    if (spaced) (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
    const size = Number.parseFloat(style.fontSize) || 16;
    const lines = style.textDecorationLine;
    const draw = (text: string, rect: DOMRect) => {
      const box = local(rect);
      if (box.w <= 0 || box.h <= 0) return;
      const shown = transform(text, style.textTransform);
      const metrics = context.measureText(shown);
      const ascent = metrics.fontBoundingBoxAscent || size * 0.8;
      const baseline = box.y + ascent;
      context.fillText(shown, box.x, baseline);
      if (lines.includes("underline") || lines.includes("line-through")) {
        const thickness = Math.max(1, size / 14);
        context.fillStyle = style.textDecorationColor || style.color;
        if (lines.includes("underline")) context.fillRect(box.x, baseline + Math.max(1, size * 0.1), box.w, thickness);
        if (lines.includes("line-through")) context.fillRect(box.x, baseline - size * 0.3, box.w, thickness);
        context.fillStyle = style.color;
      }
    };
    for (const match of data.matchAll(/\S+/g)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      range.setStart(node, start);
      range.setEnd(node, end);
      const rects = range.getClientRects();
      if (rects.length === 1) {
        draw(match[0], rects[0]);
        continue;
      }
      for (const part of graphemes(match[0])) {
        range.setStart(node, start + part.start);
        range.setEnd(node, start + part.end);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0) draw(part.text, rect);
      }
    }
  };

  const paintBox = (element: Element, style: CSSStyleDeclaration, box: Box, opacity: number) => {
    const radii: [number, number, number, number] = [radius(style.borderTopLeftRadius, box), radius(style.borderTopRightRadius, box), radius(style.borderBottomRightRadius, box), radius(style.borderBottomLeftRadius, box)];
    context.globalAlpha = opacity;
    if (!transparent(style.backgroundColor)) {
      context.fillStyle = style.backgroundColor;
      roundedPath(context, box, radii);
      context.fill();
    }
    const sides = [
      { width: style.borderTopWidth, kind: style.borderTopStyle, paint: style.borderTopColor },
      { width: style.borderRightWidth, kind: style.borderRightStyle, paint: style.borderRightColor },
      { width: style.borderBottomWidth, kind: style.borderBottomStyle, paint: style.borderBottomColor },
      { width: style.borderLeftWidth, kind: style.borderLeftStyle, paint: style.borderLeftColor },
    ].map((side) => ({ width: Number.parseFloat(side.width) || 0, kind: side.kind, paint: side.paint }));
    const drawn = sides.filter((side) => side.width > 0 && side.kind !== "none" && side.kind !== "hidden" && !transparent(side.paint));
    if (drawn.length) {
      const uniform = drawn.length === 4 && sides.every((side) => side.width === sides[0].width && side.paint === sides[0].paint && side.kind === sides[0].kind);
      const dash = (kind: string, width: number) => context.setLineDash(kind === "dashed" ? [width * 3, width * 2] : kind === "dotted" ? [width, width] : []);
      if (uniform && radii.some((r) => r > 0)) {
        const w = sides[0].width;
        context.strokeStyle = sides[0].paint;
        context.lineWidth = w;
        dash(sides[0].kind, w);
        roundedPath(context, { x: box.x + w / 2, y: box.y + w / 2, w: box.w - w, h: box.h - w }, radii.map((r) => Math.max(0, r - w / 2)) as [number, number, number, number]);
        context.stroke();
      } else {
        const lines = [
          [box.x, box.y + sides[0].width / 2, box.x + box.w, box.y + sides[0].width / 2],
          [box.x + box.w - sides[1].width / 2, box.y, box.x + box.w - sides[1].width / 2, box.y + box.h],
          [box.x, box.y + box.h - sides[2].width / 2, box.x + box.w, box.y + box.h - sides[2].width / 2],
          [box.x + sides[3].width / 2, box.y, box.x + sides[3].width / 2, box.y + box.h],
        ];
        sides.forEach((side, index) => {
          if (!drawn.includes(side)) return;
          context.strokeStyle = side.paint;
          context.lineWidth = side.width;
          dash(side.kind, side.width);
          const [x0, y0, x1, y1] = lines[index];
          context.beginPath();
          context.moveTo(x0, y0);
          context.lineTo(x1, y1);
          context.stroke();
        });
      }
      context.setLineDash([]);
    }
    if (!images) return;
    if (element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0) {
      const fit = fitImage({ w: element.naturalWidth, h: element.naturalHeight }, box, style.objectFit, style.objectPosition);
      context.drawImage(element, fit.sx, fit.sy, fit.sw, fit.sh, fit.dx, fit.dy, fit.dw, fit.dh);
    } else if (element instanceof HTMLCanvasElement && element.width > 0 && element.height > 0) {
      context.drawImage(element, box.x, box.y, box.w, box.h);
    } else if (element instanceof SVGSVGElement && box.w > 0 && box.h > 0) {
      /* SVG decodes asynchronously, so it is drawn after the walk, inside the clips it was found in (KaTeX's long radical and arrow paths rely on them). */
      const clips = clipStack.slice();
      pending.push(
        svgImage(element, style, box).then((image) => {
          if (!image) return;
          context.save();
          context.setTransform(scale, 0, 0, scale, 0, 0);
          for (const clip of clips) {
            context.beginPath();
            context.rect(clip.x, clip.y, clip.w, clip.h);
            context.clip();
          }
          context.globalAlpha = opacity;
          context.drawImage(image, box.x, box.y, box.w, box.h);
          context.restore();
        }),
      );
    }
  };
  const clipStack: Box[] = [];

  const walk = (element: Element, opacity: number, isFace: boolean) => {
    const style = getComputedStyle(element);
    if (style.display === "none") return;
    const box = local(element.getBoundingClientRect());
    if (!isFace && hidden(style, box)) return;
    if (element instanceof HTMLElement && element.dataset.crumpleSkip !== undefined) return;
    const own = isFace ? 1 : opacity * (Number.parseFloat(style.opacity) || (style.opacity === "0" ? 0 : 1));
    if (own <= 0.002) return;
    if (!isFace) paintBox(element, style, box, own);
    if (element instanceof SVGSVGElement || element instanceof HTMLImageElement || element instanceof HTMLCanvasElement) return;
    if (element.tagName === "SCRIPT" || element.tagName === "STYLE" || element.tagName === "TEMPLATE") return;
    const clips = !isFace && style.overflow !== "visible" && style.overflow !== "";
    if (clips) {
      context.save();
      context.beginPath();
      context.rect(box.x, box.y, box.w, box.h);
      context.clip();
      clipStack.push(box);
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) paintText(child as Text, style, own);
      else if (child.nodeType === Node.ELEMENT_NODE) walk(child as Element, own, false);
    }
    if (clips) {
      context.restore();
      clipStack.pop();
    }
  };

  walk(face, 1, true);
  await Promise.all(pending);
  context.globalAlpha = 1;
  try {
    context.getImageData(0, 0, 1, 1);
    return { tainted: false };
  } catch {
    return { tainted: true };
  }
}
