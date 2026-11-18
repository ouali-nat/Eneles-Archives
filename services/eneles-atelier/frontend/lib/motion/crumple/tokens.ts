import { readCssColor } from "@/lib/motion/color";
import { readMs } from "@/lib/motion/dom";
import { cubicBezier, parseEase, type Ease } from "@/lib/motion/crumple/progress";

/* Everything the crumple engine takes from CSS, read from a sheet's root: the --crumple-* colors CrumpledPaperReveal sets on its root (each a mix of the palette's own tokens, so a sheet follows both themes), the site's light (--light-angle and --light-rim, registered in app/globals.css), and the timing tokens. Colors come back in linear light, which is where the shader mixes them. */

export type Linear = [number, number, number];

export type CrumpleTokens = {
  paper: Linear;
  back: Linear;
  rule: Linear;
  ruleStrong: Linear;
  margin: Linear;
  dot: Linear;
  /* Linear color and alpha. */
  shadow: [number, number, number, number];
  key: Linear;
  lamp: Linear;
  sky: Linear;
  bounce: Linear;
  /* Degrees clockwise from the top, and the rim light's strength, 0 to 1. */
  lightAngle: number;
  lightRim: number;
  openDuration: number;
  closeDuration: number;
  fadeDuration: number;
  openEase: Ease;
  closeEase: Ease;
  grid: number;
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function color(style: CSSStyleDeclaration, token: string, fallback: Linear): Linear {
  const value = style.getPropertyValue(token).trim();
  if (!value) return fallback;
  const [r, g, b, a] = readCssColor(value);
  if (a === 0) return fallback;
  return [toLinear(r), toLinear(g), toLinear(b)];
}

function angle(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  if (raw.endsWith("rad")) return (value * 180) / Math.PI;
  if (raw.endsWith("turn")) return value * 360;
  if (raw.endsWith("grad")) return value * 0.9;
  return value;
}

function pixels(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && raw.trim().endsWith("px") ? value : fallback;
}

const defaultOpen = cubicBezier(0.42, 0, 0.18, 1);
const defaultClose = cubicBezier(0.6, 0.02, 0.8, 0.35);

export function readCrumpleTokens(root: HTMLElement): CrumpleTokens {
  const style = getComputedStyle(root);
  const paper = color(style, "--crumple-paper", [0.9, 0.88, 0.82]);
  const shadowValue = style.getPropertyValue("--crumple-shadow").trim();
  const [sr, sg, sb, sa] = shadowValue ? readCssColor(shadowValue) : [0, 0, 0, 0.35];
  const rim = Number.parseFloat(style.getPropertyValue("--light-rim"));
  return {
    paper,
    back: color(style, "--crumple-back", paper),
    rule: color(style, "--crumple-rule", paper),
    ruleStrong: color(style, "--crumple-rule-strong", paper),
    margin: color(style, "--crumple-margin", paper),
    dot: color(style, "--crumple-dot", paper),
    shadow: [toLinear(sr), toLinear(sg), toLinear(sb), sa],
    key: color(style, "--crumple-key", [1, 0.97, 0.92]),
    lamp: color(style, "--crumple-lamp", [1, 0.96, 0.9]),
    sky: color(style, "--crumple-sky", [0.8, 0.82, 0.86]),
    bounce: color(style, "--crumple-bounce", [0.1, 0.1, 0.1]),
    lightAngle: angle(style.getPropertyValue("--light-angle").trim(), 315),
    lightRim: Number.isFinite(rim) ? Math.min(1, Math.max(0, rim)) : 0,
    openDuration: readMs(root, "--crumple-open-duration", 1500),
    closeDuration: readMs(root, "--crumple-close-duration", 950),
    fadeDuration: readMs(root, "--motion-fade-duration", 200),
    openEase: parseEase(style.getPropertyValue("--crumple-open-ease"), defaultOpen),
    closeEase: parseEase(style.getPropertyValue("--crumple-close-ease"), defaultClose),
    grid: pixels(style.getPropertyValue("--crumple-grid"), 20),
  };
}
