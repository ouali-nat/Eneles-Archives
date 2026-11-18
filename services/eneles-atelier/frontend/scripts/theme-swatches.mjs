// Writes lib/editor/theme-swatches.ts: for each editor theme, its background and its four main syntax colors, read from the theme packages themselves. The theme menu draws them beside each name, so a theme can be judged before it is loaded. Run it again after adding a theme to lib/editor/themes.ts: `node scripts/theme-swatches.mjs`.
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/editor/themes.ts", import.meta.url), "utf8");
const cases = [...source.matchAll(/case "([^"]+)": \{\s*const m = await import\("([^"]+)"\);\s*return m\.(\w+);/g)].filter(([, , pkg]) => !pkg.startsWith("."));
const cap = (s) => s[0].toUpperCase() + s.slice(1);
// "#abc", "#aabbcc", or "#aabbccdd" to "#aabbcc"; anything else is skipped.
const hex = (c) => {
  if (typeof c !== "string") return null;
  const m = c.trim().toLowerCase().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1].slice(0, 6);
  return `#${h}`;
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const far = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

const out = {};
for (const [, id, pkg, name] of cases) {
  const m = await import(pkg);
  // The packages name these exports loosely ("draculaDarkStyle" beside "dracula"), so each is found by its ending, nearest the theme's own name first.
  const find = (test) => Object.keys(m).filter(test).sort((a, b) => Number(b.toLowerCase().includes(name.toLowerCase())) - Number(a.toLowerCase().includes(name.toLowerCase())) || a.length - b.length)[0];
  const settings = m[`defaultSettings${cap(name)}`] ?? m[find((k) => k.startsWith("defaultSettings"))] ?? {};
  const styles = m[`${name}Style`] ?? m[find((k) => k.endsWith("Style"))] ?? [];
  if (!styles.length) throw new Error(`No syntax colors exported by ${pkg} for ${name}`);
  const background = hex(settings.background) ?? (id.includes("light") ? "#ffffff" : "#1e1e1e");
  const picked = [];
  // The syntax colors in the theme's own order, skipping ones too close to the background or to one already taken.
  for (const color of [...styles.map((s) => hex(s.color)), hex(settings.foreground)]) {
    if (!color || far(color, background) < 60 || picked.some((p) => far(p, color) < 48)) continue;
    picked.push(color);
    if (picked.length === 4) break;
  }
  const foreground = hex(settings.foreground) ?? picked[0] ?? "#888888";
  while (picked.length < 4) picked.push(picked[picked.length - 1] ?? foreground);
  out[id] = [background, ...picked];
}

// Thry is written against the site's tokens, not fixed colors, so its sample is the tokens themselves and follows the site's mode.
out.thry = ["var(--background)", "var(--hue-blue)", "var(--hue-purple)", "var(--hue-teal)", "var(--hue-orange)"];

const missing = [...source.matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]).filter((id) => !out[id]);
if (missing.length) throw new Error(`No colors found for: ${missing.join(", ")}`);

const body = Object.entries(out)
  .map(([id, colors]) => `  "${id}": [${colors.map((c) => `"${c}"`).join(", ")}],`)
  .join("\n");
writeFileSync(
  new URL("../lib/editor/theme-swatches.ts", import.meta.url),
  `/* Written by scripts/theme-swatches.mjs from the theme packages: do not edit by hand. Each theme's background, then its four main syntax colors. These are the themes' own colors, shown as a sample of the theme, which is why they are literal values and not the site's tokens. */\nexport const THEME_SWATCHES: Record<string, readonly [background: string, a: string, b: string, c: string, d: string]> = {\n${body}\n};\n`,
);
console.log(`Wrote ${Object.keys(out).length} themes`);
