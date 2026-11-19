/**
 * Faces for people. Everyone has one: an uploaded photo, else the generated picture they chose, else one derived from their account, so the same person looks the same everywhere and nobody is shown as bare initials.
 *
 * A generated picture has a style, a seed, and a color, chosen independently. The styles: a dither (a smooth field of light compared cell by cell against a Bayer threshold matrix), a gradient (soft shapes in deep shades of the color, blurred into one lit surface), and a pixel glyph (a mirrored 5 by 5 pattern). The seed fixes the variation; the color is one of the interface's ten categorical hues, applied by the stylesheet so it follows the theme. Everything here is deterministic: one value draws one picture in every browser.
 *
 * `User.avatarUrl` holds a photo's storage key, a full link to a photo, or a preset `<style>:<seed>:<hue>` (for example `gradient:4821:teal`). Values written before styles existed are `dither:<seed>:<hue>` and read the same.
 */

import { API_URL } from "@/lib/api/client";

/** The ten categorical hues, in the order the stylesheet defines them. */
export const AVATAR_HUES = ["grey", "red", "orange", "amber", "green", "teal", "blue", "indigo", "purple", "pink"] as const;
export type AvatarHue = (typeof AVATAR_HUES)[number];
/** Grey is offered in the picker but never drawn at random: a first picture always has a color. */
const COLORED_HUES = AVATAR_HUES.filter((hue) => hue !== "grey");

export const AVATAR_STYLES = ["dither", "gradient", "pixel"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];
export const AVATAR_STYLE_LABELS: Record<AvatarStyle, string> = { dither: "Dither", gradient: "Gradient", pixel: "Pixel" };

export const AVATAR_SEED_LIMIT = 1_000_000;

export type AvatarPreset = { style: AvatarStyle; seed: number; hue: AvatarHue };

/** A person as far as their face is concerned. Any field may be missing; the face falls back to what is known. */
export type AvatarPerson = {
  id?: number | string | null;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

export type Face = { kind: "photo"; src: string; fallback: AvatarPreset } | { kind: "preset"; preset: AvatarPreset };

const PRESET = new RegExp(`^(${AVATAR_STYLES.join("|")}):(\\d{1,6}):(${AVATAR_HUES.join("|")})$`);

export function parsePreset(value: string | null | undefined): AvatarPreset | null {
  const match = value ? PRESET.exec(value) : null;
  return match ? { style: match[1] as AvatarStyle, seed: Number(match[2]), hue: match[3] as AvatarHue } : null;
}

export function formatPreset(preset: AvatarPreset): string {
  return `${preset.style}:${preset.seed}:${preset.hue}`;
}

export function samePreset(a: AvatarPreset | null, b: AvatarPreset | null) {
  return !!a && !!b && a.style === b.style && a.seed === b.seed && a.hue === b.hue;
}

/** True for a value that is a photo (a link or a storage key), as opposed to a preset or nothing. */
export function isPhotoValue(value: string | null | undefined) {
  return !!value && !parsePreset(value);
}

/** FNV-1a over the string's UTF-16 units: a stable 32-bit number for an id or an address. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** SplitMix32: a short stream of numbers in [0, 1) from a 32-bit seed. */
function stream(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

/** The picture everyone has before choosing one, derived from what identifies them best: their id, else their address, else their name. Always a dither, so faces people already know do not change. */
export function derivedPreset(person: AvatarPerson): AvatarPreset {
  const key = person.id != null && person.id !== "" ? `id:${person.id}` : person.email ? `email:${person.email.trim().toLowerCase()}` : `name:${(person.name ?? "").trim()}`;
  const hash = hashString(key);
  return { style: "dither", seed: hash % AVATAR_SEED_LIMIT, hue: COLORED_HUES[Math.floor(hash / AVATAR_SEED_LIMIT) % COLORED_HUES.length] };
}

/** Another variation of the same style and color. */
export function shufflePreset(preset: AvatarPreset, random: () => number = Math.random): AvatarPreset {
  let seed = preset.seed;
  while (seed === preset.seed) seed = Math.floor(random() * AVATAR_SEED_LIMIT);
  return { ...preset, seed };
}

/** What to draw for a person: their photo (with their derived picture as the fallback should it fail to load), else their chosen picture, else the derived one. */
export function faceOf(person: AvatarPerson): Face {
  const value = person.avatarUrl?.trim() || null;
  const preset = parsePreset(value);
  if (preset) return { kind: "preset", preset };
  const fallback = derivedPreset(person);
  if (value && /^(https?:|blob:|data:image\/)/i.test(value)) return { kind: "photo", src: value, fallback };
  // A bare storage key: the photo is read through the API, which knows whose it is.
  if (value && person.id != null && person.id !== "") return { kind: "photo", src: `${API_URL}/users/${person.id}/avatar`, fallback };
  return { kind: "preset", preset: fallback };
}

// ─── Dither ──────────────────────────────────────────────────────────────

/** An 8 by 8 Bayer matrix as thresholds in (0, 1), built by the usual doubling so every level of the ramp lights cells evenly. */
const BAYER: number[][] = (() => {
  let m = [[0]];
  while (m.length < 8) {
    const n = m.length;
    const next: number[][] = Array.from({ length: n * 2 }, () => new Array<number>(n * 2).fill(0));
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + n] = v + 2;
        next[y + n][x] = v + 3;
        next[y + n][x + n] = v + 1;
      }
    m = next;
  }
  return m.map((row) => row.map((v) => (v + 0.5) / 64));
})();

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** The lit cells of a `cells` by `cells` grid as one SVG path, each row's runs merged, with whole-number coordinates so every cell lands on whole pixels. */
export function ditherPath(seed: number, cells: number): string {
  const random = stream(hashString(`dither:${seed}`));
  // Two in five are a pool of light around a point; the rest a ramp across the face. The lift sets how much light the whole face starts with, so some pictures are darker and some brighter, but none is mostly ground.
  const radial = random() < 0.4;
  const angle = random() * Math.PI * 2;
  const cx = 0.2 + random() * 0.6;
  const cy = 0.15 + random() * 0.55;
  const spread = 0.6 + random() * 0.35;
  const lift = -0.02 + random() * 0.2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let path = "";
  for (let y = 0; y < cells; y++) {
    const v = (y + 0.5) / cells;
    let start = -1;
    for (let x = 0; x <= cells; x++) {
      let lit = false;
      if (x < cells) {
        const u = (x + 0.5) / cells;
        const light = radial ? 1 - Math.hypot(u - cx, v - cy) / spread : 0.5 + ((u - 0.5) * cos + (v - 0.5) * sin) / spread;
        lit = smooth(light + lift) > BAYER[y & 7][x & 7];
      }
      if (lit && start < 0) start = x;
      else if (!lit && start >= 0) {
        path += `M${start} ${y}h${x - start}v1h${start - x}z`;
        start = -1;
      }
    }
  }
  return path;
}

// ─── Gradient ────────────────────────────────────────────────────────────

export type GradientBlob = { cx: number; cy: number; rx: number; ry: number; turn: number; shade: "ground" | "mid" };

/** Four soft ellipses in a 100 by 100 box, placed and turned by the seed, two in the deep shade and two in the middle one. The face blurs them over the bright color, so they read as one lit, shifting surface. */
export function gradientBlobs(seed: number): GradientBlob[] {
  const random = stream(hashString(`gradient:${seed}`));
  const round = (n: number) => Math.round(n * 10) / 10;
  return [0, 1, 2, 3].map((i) => {
    const angle = random() * Math.PI * 2;
    const distance = 22 + random() * 26;
    return {
      cx: round(50 + Math.cos(angle) * distance),
      cy: round(50 + Math.sin(angle) * distance),
      rx: round(26 + random() * 22),
      ry: round(16 + random() * 18),
      turn: Math.round(random() * 180),
      shade: i % 2 === 0 ? "ground" : "mid",
    };
  });
}

// ─── Pixel ───────────────────────────────────────────────────────────────

export const PIXEL_GRID = 5;
export type PixelCell = { x: number; y: number; tone: 1 | 2 };

/** A 5 by 5 glyph mirrored left to right or top to bottom (the seed picks), about a third of its cells in a second tone. A glyph too sparse, too full, or not reaching the edge of its grid is drawn again, so every seed gives one that reads. */
export function pixelGlyph(seed: number): PixelCell[] {
  let cells: PixelCell[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const random = stream(hashString(`pixel:${seed}:${attempt}`));
    const mirrorRows = random() < 0.5;
    const half = Math.ceil(PIXEL_GRID / 2);
    const bits = Array.from({ length: half * PIXEL_GRID }, () => ({ on: random() < 0.5, tone: (random() < 0.33 ? 2 : 1) as 1 | 2 }));
    cells = [];
    for (let y = 0; y < PIXEL_GRID; y++)
      for (let x = 0; x < PIXEL_GRID; x++) {
        const folded = mirrorRows ? Math.min(y, PIXEL_GRID - 1 - y) : Math.min(x, PIXEL_GRID - 1 - x);
        const free = mirrorRows ? x : y;
        const bit = bits[folded * PIXEL_GRID + free];
        if (bit.on) cells.push({ x, y, tone: bit.tone });
      }
    const edge = PIXEL_GRID - 1;
    if (cells.length >= 8 && cells.length <= 18 && cells.some((c) => c.x === 0 || c.y === 0 || c.x === edge || c.y === edge)) break;
  }
  return cells;
}
