/* Resolving CSS color tokens to numbers for canvas and WebGL drawing. Every color comes from the site's tokens, read at runtime through `readCssColor`, so a picture follows the theme. */

export type Rgba = readonly [number, number, number, number];

/* A canvas ignores a fill it cannot parse and keeps the one before, so the probe sets a sentinel first: a fill that still reads as the sentinel was rejected, which a real transparent token never is. A fill that reads as the first sentinel is tried once more over the second, so a token that really is that color still resolves. */
const REJECTED = "#010203";
const REJECTED_AGAIN = "#030201";
const MID_GRAY: Rgba = [0.5, 0.5, 0.5, 1];

/* Whether a 2D canvas rejects `text` as a fill. */
function rejects(text: string, probe: CanvasRenderingContext2D) {
  for (const sentinel of [REJECTED, REJECTED_AGAIN]) {
    probe.fillStyle = sentinel;
    probe.fillStyle = text;
    if (probe.fillStyle !== sentinel) return false;
  }
  return true;
}

/* Splits a function's arguments at its top-level commas, leaving commas inside nested functions alone. */
function topLevelArguments(inside: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inside.length; index += 1) {
    const character = inside[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(inside.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(inside.slice(start).trim());
  return parts;
}

/* The first color a color-mix() mixes, with its percentage dropped: the token's unmixed color, the closest thing to it a canvas without color-mix can still draw. Null for anything else. */
function firstMixedColor(expression: string) {
  const match = /^color-mix\(([\s\S]*)\)$/i.exec(expression);
  if (!match) return null;
  const parts = topLevelArguments(match[1]).filter((part) => !/^in\s/i.test(part));
  const first = parts[0]?.replace(/^\d*\.?\d+%\s+/, "").replace(/\s+\d*\.?\d+%$/, "").trim();
  return first || null;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const linearToSrgb = (channel: number) => (channel > 0.0031308 ? 1.055 * channel ** (1 / 2.4) - 0.055 : 12.92 * channel);

/* An oklch() literal as sRGB, for a canvas that reads no oklch: converted through OKLab and clipped to the sRGB gamut (the site's tokens are all inside it or close). Lightness may be a number or a percent, chroma a number, hue in degrees; "none" reads as 0. Null for anything else. */
function oklchFallback(text: string): Rgba | null {
  const match = /^oklch\(\s*([^\s/]+)\s+([^\s/]+)\s+([^\s/)]+)\s*(?:\/\s*([^\s)]+))?\s*\)$/i.exec(text);
  if (!match) return null;
  const read = (part: string, whole: number) => (part === "none" ? 0 : part.endsWith("%") ? (Number.parseFloat(part) / 100) * whole : Number.parseFloat(part));
  const l = read(match[1], 1);
  const c = read(match[2], 0.4);
  const h = (read(match[3].replace(/deg$/, ""), 1) * Math.PI) / 180;
  const alpha = match[4] === undefined ? 1 : read(match[4], 1);
  if (![l, c, h, alpha].every(Number.isFinite)) return null;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short;
  const g = -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short;
  const blue = -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short;
  return [clamp01(linearToSrgb(clamp01(r))), clamp01(linearToSrgb(clamp01(g))), clamp01(linearToSrgb(clamp01(blue))), clamp01(alpha)];
}

/* Resolve a CSS color expression to 0..1 RGBA through a 2D canvas, which understands oklch and color-mix where the browser does. An empty token is transparent. An expression the canvas rejects falls back to the first color of its color-mix (itself resolved the same way, since it may be a mix too); an oklch literal it still rejects is converted here; only what neither reads is mid gray, so a picture never vanishes because one token did not parse. */
function resolve(expression: string, probe: CanvasRenderingContext2D, depth = 0): Rgba {
  const text = expression.trim();
  if (!text) return [0, 0, 0, 0];
  if (rejects(text, probe)) {
    const first = depth < 4 ? firstMixedColor(text) : null;
    if (first) return resolve(first, probe, depth + 1);
    return oklchFallback(text) ?? MID_GRAY;
  }
  probe.clearRect(0, 0, 1, 1);
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255, a / 255];
}

let sharedProbe: CanvasRenderingContext2D | null | undefined;

/* Every canvas and WebGL piece resolves token colors here, never through a probe of its own; transparent where no 2D canvas exists. */
export function readCssColor(expression: string): Rgba {
  if (sharedProbe === undefined) {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    sharedProbe = probe.getContext("2d", { willReadFrequently: true });
  }
  return sharedProbe ? resolve(expression, sharedProbe) : [0, 0, 0, 0];
}
