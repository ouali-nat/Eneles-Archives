/**
 * Labels a person colors. A label's color is one of the theme's ten hues, so
 * it reads right in light and dark. Older labels saved a hex value from the
 * previous picker; those map to their nearest hue for display.
 */

export const LABEL_HUES = [
  "grey",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;

export type LabelHue = (typeof LABEL_HUES)[number];

/** Classes per hue, written out so the class scanner sees each one. */
export const LABEL_HUE_CLASSES: Record<LabelHue, { dot: string; chip: string; swatch: string }> = {
  grey: { dot: "bg-hue-grey", chip: "bg-hue-grey/12 text-hue-grey border-hue-grey/30", swatch: "bg-hue-grey" },
  red: { dot: "bg-hue-red", chip: "bg-hue-red/12 text-hue-red border-hue-red/30", swatch: "bg-hue-red" },
  orange: { dot: "bg-hue-orange", chip: "bg-hue-orange/12 text-hue-orange border-hue-orange/30", swatch: "bg-hue-orange" },
  amber: { dot: "bg-hue-amber", chip: "bg-hue-amber/12 text-hue-amber border-hue-amber/30", swatch: "bg-hue-amber" },
  green: { dot: "bg-hue-green", chip: "bg-hue-green/12 text-hue-green border-hue-green/30", swatch: "bg-hue-green" },
  teal: { dot: "bg-hue-teal", chip: "bg-hue-teal/12 text-hue-teal border-hue-teal/30", swatch: "bg-hue-teal" },
  blue: { dot: "bg-hue-blue", chip: "bg-hue-blue/12 text-hue-blue border-hue-blue/30", swatch: "bg-hue-blue" },
  indigo: { dot: "bg-hue-indigo", chip: "bg-hue-indigo/12 text-hue-indigo border-hue-indigo/30", swatch: "bg-hue-indigo" },
  purple: { dot: "bg-hue-purple", chip: "bg-hue-purple/12 text-hue-purple border-hue-purple/30", swatch: "bg-hue-purple" },
  pink: { dot: "bg-hue-pink", chip: "bg-hue-pink/12 text-hue-pink border-hue-pink/30", swatch: "bg-hue-pink" },
};

export const LABEL_HUE_NAMES: Record<LabelHue, string> = {
  grey: "Grey",
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  indigo: "Indigo",
  purple: "Purple",
  pink: "Pink",
};

function isHue(value: string): value is LabelHue {
  return (LABEL_HUES as readonly string[]).includes(value);
}

/** Where each hue sits on the HSV wheel (degrees), for matching a legacy hex. */
const HUE_ANGLES: [LabelHue, number][] = [
  ["red", 0],
  ["orange", 25],
  ["amber", 55],
  ["green", 115],
  ["teal", 170],
  ["blue", 220],
  ["indigo", 255],
  ["purple", 285],
  ["pink", 330],
];

/** A stored label color (a hue name, or a legacy hex) as one of the ten hues. */
export function labelHue(color: string | null | undefined): LabelHue | null {
  if (!color) return null;
  const value = color.trim().toLowerCase();
  if (isHue(value)) return value;
  const hex = /^#?([0-9a-f]{6})$/.exec(value)?.[1];
  if (!hex) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return "grey";
  let h: number;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  const angle = (h * 60 + 360) % 360;
  let best: LabelHue = "grey";
  let distance = Infinity;
  for (const [hue, a] of HUE_ANGLES) {
    const d = Math.min(Math.abs(angle - a), 360 - Math.abs(angle - a));
    if (d < distance) {
      distance = d;
      best = hue;
    }
  }
  return best;
}
