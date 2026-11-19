import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, SRGBColorSpace, type ColorSpace } from "three";
import { paintFace } from "@/lib/motion/crumple/domPaint";

/* The sheet's content as textures: the ink (the face's DOM painted by domPaint.ts into a transparent canvas at the sheet's size bucket, premultiplied as the canvas stores it and left sRGB-encoded for the shader to decode after unpremultiplying, because the GPU's sRGB decode of a premultiplied value darkens every partly covered pixel of light ink; mipmapped) and the print (the image prop, decoded and cropped to its box by object-fit cover around its focus point, so the shader maps it straight onto the print's rectangle). Also the face's layout facts the shader needs: where the print sits, the ruling's first line and spacing, the margin rule's side, and the face's blend mode, which is read from CSS so there is one source of truth. */

export type FaceLayout = {
  /* The print's rectangle in sheet uv (origin bottom-left): x0, y0, x1, y1, or null without a print. */
  print: [number, number, number, number] | null;
  /* Pixels from the top to the first rule, and the rule spacing (the face's line height). */
  firstLine: number;
  line: number;
  rtl: boolean;
  /* 0 multiply (dark ink on light paper), 1 screen (light ink on dark paper). */
  blend: 0 | 1;
  /* The print box's size in CSS pixels, for cropping. */
  printSize: [number, number];
};

/* The rules sit this far up a line box from its bottom, so text written on the face sits on them. */
export const RULE_RAISE = 0.24;

export function measureFace(face: HTMLElement, width: number, height: number): FaceLayout {
  const style = getComputedStyle(face);
  const padTop = Number.parseFloat(style.paddingTop) || 0;
  const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 28;
  const origin = face.getBoundingClientRect();
  const zoom = face.offsetWidth > 0 ? origin.width / face.offsetWidth : 1;
  const label = face.querySelector<HTMLElement>(":scope > .crumple-print-label");
  let print: FaceLayout["print"] = null;
  let printSize: [number, number] = [0, 0];
  if (label && width > 0 && height > 0) {
    const rect = label.getBoundingClientRect();
    const x = (rect.left - origin.left) / zoom;
    const y = (rect.top - origin.top) / zoom;
    const w = rect.width / zoom;
    const h = rect.height / zoom;
    if (w > 1 && h > 1) {
      print = [x / width, 1 - (y + h) / height, (x + w) / width, 1 - y / height];
      printSize = [w, h];
    }
  }
  return { print, firstLine: padTop + line * (1 - RULE_RAISE), line, rtl: style.direction === "rtl", blend: style.mixBlendMode === "screen" ? 1 : 0, printSize };
}

function canvasTexture(canvas: HTMLCanvasElement, premultiplied: boolean, colorSpace: ColorSpace, anisotropy: number) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.premultiplyAlpha = premultiplied;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.anisotropy = anisotropy;
  return texture;
}

/* The ink layer: a canvas and its texture, repainted on request. A paint that turns out tainted is redone without images (they show once the sheet lies flat, as live DOM). */
export class InkLayer {
  readonly canvas = document.createElement("canvas");
  readonly texture: CanvasTexture;
  private painting: Promise<void> | null = null;
  private again = false;
  private disposed = false;
  constructor(anisotropy: number) {
    this.canvas.width = this.canvas.height = 1;
    this.texture = canvasTexture(this.canvas, true, NoColorSpace, anisotropy);
  }
  /* Paints the face at `scale` device pixels per CSS pixel; a call while a paint runs queues one more. */
  paint(face: HTMLElement, width: number, height: number, scale: number, done: () => void) {
    if (this.disposed) return;
    if (this.painting) {
      this.again = true;
      return;
    }
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    this.painting = (async () => {
      /* three allocates immutable texture storage at the first size, so a new size needs a fresh texture. */
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.texture.dispose();
        this.canvas.width = w;
        this.canvas.height = h;
      }
      const first = await paintFace(face, this.canvas, scale);
      if (first.tainted && !this.disposed) await paintFace(face, this.canvas, scale, { images: false });
      if (!this.disposed) this.texture.needsUpdate = true;
    })()
      .catch(() => {})
      .finally(() => {
        this.painting = null;
        if (this.disposed) return;
        done();
        if (this.again) {
          this.again = false;
          this.paint(face, width, height, scale, done);
        }
      });
  }
  dispose() {
    this.disposed = true;
    this.texture.dispose();
    this.canvas.width = this.canvas.height = 0;
  }
}

/* Decoded images by source, shared by every sheet showing the same print. */
const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  const cached = images.get(src);
  if (cached) return cached;
  const made = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      void image
        .decode()
        .catch(() => {})
        .then(() => resolve(image));
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
  images.set(src, made);
  if (images.size > 16) images.delete(images.keys().next().value as string);
  return made;
}

/* The print layer: the image cropped into a canvas of the print box's shape at the bucket's resolution. A failed or tainted image leaves the paper without a print. */
export class PrintLayer {
  readonly canvas = document.createElement("canvas");
  readonly texture: CanvasTexture;
  ready = false;
  private key = "";
  constructor(anisotropy: number) {
    this.canvas.width = this.canvas.height = 1;
    this.texture = canvasTexture(this.canvas, false, SRGBColorSpace, anisotropy);
  }
  update(src: string | undefined, focus: readonly [number, number], size: [number, number], scale: number, done: () => void) {
    if (this.key === "disposed") return;
    if (!src || size[0] < 1 || size[1] < 1) {
      this.key = "";
      this.ready = false;
      return;
    }
    const w = Math.max(1, Math.min(2048, Math.round(size[0] * scale)));
    const h = Math.max(1, Math.min(2048, Math.round(size[1] * scale)));
    const key = `${src}|${focus[0]}:${focus[1]}|${w}x${h}`;
    if (key === this.key) return;
    this.key = key;
    void loadImage(src).then((image) => {
      if (this.key !== key) return;
      const context = this.canvas.getContext("2d");
      if (!image || !context || !image.naturalWidth) {
        this.ready = false;
        done();
        return;
      }
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.texture.dispose();
        this.canvas.width = w;
        this.canvas.height = h;
      }
      const ratio = Math.max(w / image.naturalWidth, h / image.naturalHeight);
      const sw = w / ratio;
      const sh = h / ratio;
      const sx = (image.naturalWidth - sw) * Math.min(1, Math.max(0, focus[0]));
      const sy = (image.naturalHeight - sh) * Math.min(1, Math.max(0, focus[1]));
      context.imageSmoothingQuality = "high";
      context.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
      try {
        context.getImageData(0, 0, 1, 1);
        this.ready = true;
        this.texture.needsUpdate = true;
      } catch {
        this.ready = false;
      }
      done();
    });
  }
  dispose() {
    /* A pending image load sees its key gone and leaves the canvas alone. */
    this.key = "disposed";
    this.ready = false;
    this.texture.dispose();
    this.canvas.width = this.canvas.height = 0;
  }
}
