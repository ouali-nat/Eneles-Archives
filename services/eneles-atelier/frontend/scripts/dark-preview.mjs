// Makes the dark theme's version of a Library preview: the same figure on a transparent ground, with its colors kept. The previews are pages TeX compiled, rendered to PNG on white (library/scripts/check.mjs --previews). A filter in the browser cannot set them on a dark card well: inverting the image turns every color into its opposite. So each pixel is worked out here instead:
//
// - The white of the page becomes transparent. Each pixel is read as some ink laid over white with some coverage (the least coverage that explains it, as "color to alpha" does), so antialiased edges and light tints keep their softness: a 10% blue fill becomes blue at 10%, not a pale blue block.
// - Black and grey ink (lines, labels, axes: anything without much color) turns light, the way text does in the dark theme, so it reads on a dark card.
// - Colored ink keeps its color: solid color (a bar, a filled plot, a colormap) stays exactly as it is and opaque, and only faint tints and antialiased edges become translucent. Only a color so dark it would vanish on a dark card is lightened, just enough to read, keeping its hue.
//
// No dependencies: a small PNG reader and writer over node:zlib, for the 8-bit, non-interlaced images pdftocairo writes.

import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The image as RGBA bytes, or null for a kind of PNG this does not read (16-bit, palette, interlaced). */
function decode(file) {
  if (!file.subarray(0, 8).equals(SIGNATURE)) return null;
  let at = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const data = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const name = file.toString("latin1", at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (name === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (name === "IDAT") data.push(body);
    else if (name === "IEND") break;
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) return null;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 0xff;
    }
  }
  // Everything as RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const gray = channels <= 2;
    rgba[i * 4] = pixels[j];
    rgba[i * 4 + 1] = gray ? pixels[j] : pixels[j + 1];
    rgba[i * 4 + 2] = gray ? pixels[j] : pixels[j + 2];
    rgba[i * 4 + 3] = channels === 4 ? pixels[j + 3] : channels === 2 ? pixels[j + 1] : 255;
  }
  return { width, height, rgba };
}

function chunk(name, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(name, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

function encode({ width, height, rgba }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  // Each row filtered by the pixel to its left (filter 1), which suits large flat areas.
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 1;
    for (let x = 0; x < stride; x++) {
      const v = rgba[y * stride + x];
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      raw[y * (stride + 1) + 1 + x] = (v - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** How light a color looks, 0 to 1 (relative luminance of sRGB). */
function luminance(r, g, b) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The ink for the dark theme: light grey for black, and in between for greys. */
const INK = 236;
/** A color darker than this is lightened until it reaches it. */
const DARKEST = 0.05;
/** Colored ink at least this solid is kept exactly as it is, opaque: a filled plot keeps its colormap. Below it (tints, antialiased edges) it is laid as translucent ink. */
const SOLID = 0.6;

/** The dark theme's version of a preview PNG, or null if the PNG is of a kind this does not read. */
export function darkPreview(png) {
  const image = decode(png);
  if (!image) return null;
  const { rgba } = image;
  const lifted = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    // Laid over white first, if the image has its own transparency.
    const alpha = rgba[i + 3] / 255;
    const r0 = 255 - alpha * (255 - rgba[i]);
    const g0 = 255 - alpha * (255 - rgba[i + 1]);
    const b0 = 255 - alpha * (255 - rgba[i + 2]);
    // The least coverage of some ink over white that gives this pixel, and that ink.
    const dr = 255 - r0, dg = 255 - g0, db = 255 - b0;
    const cover = Math.max(dr, dg, db) / 255;
    if (cover <= 0.004) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
      continue;
    }
    let r = 255 - dr / cover, g = 255 - dg / cover, b = 255 - db / cover;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    let opacity = cover;
    if (spread >= 40 && cover >= SOLID) {
      // Solid color: exactly the color on the page.
      r = r0;
      g = g0;
      b = b0;
      opacity = 1;
    }
    if (spread < 40) {
      // Black or grey ink: as light as it was dark.
      const level = Math.round(INK * (1 - (r + g + b) / 3 / 255) + ((r + g + b) / 3) * 0.12);
      r = g = b = level;
    } else if (luminance(r, g, b) < DARKEST) {
      // Too dark to read on a dark card: lightened toward white, just enough, keeping its hue.
      const key = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
      let mixed = lifted.get(key);
      if (!mixed) {
        let t = 0;
        while (t < 1 && luminance(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t) < DARKEST) t += 0.02;
        mixed = [r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t];
        lifted.set(key, mixed);
      }
      [r, g, b] = mixed;
    }
    rgba[i] = Math.round(r);
    rgba[i + 1] = Math.round(g);
    rgba[i + 2] = Math.round(b);
    rgba[i + 3] = Math.round(opacity * 255);
  }
  return encode(image);
}
