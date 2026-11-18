import { stepSpring, type Spring, type SpringState } from "@/lib/motion/spring";

/* Timing for the crumple: tweens of the openness with reversal, CSS easings parsed from the timing tokens, the scroll mapping, and spring steps over lib/motion/spring.ts for the scrub, the lamp, the landing settle, and the closing squeeze. */

export type Ease = (t: number) => number;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

/* A CSS cubic-bezier(x1, y1, x2, y2) as a function of progress: Newton steps on x(s), with bisection where the slope is flat. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t: number) => {
    const x = clamp01(t);
    let s = x;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(s) - x;
      if (Math.abs(error) < 1e-6) return sampleY(s);
      const slope = slopeX(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let low = 0;
    let high = 1;
    s = x;
    for (let i = 0; i < 24; i += 1) {
      const value = sampleX(s);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) low = s;
      else high = s;
      s = (low + high) / 2;
    }
    return sampleY(s);
  };
}

const named: Record<string, readonly [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/* An easing token's value (`cubic-bezier(...)`, a keyword, or `linear`) as a function; anything else falls back. */
export function parseEase(value: string, fallback: Ease): Ease {
  const text = value.trim();
  if (text === "linear") return (t) => clamp01(t);
  const keyword = named[text];
  if (keyword) return cubicBezier(...keyword);
  const match = text.match(/^cubic-bezier\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*\)$/);
  if (!match) return fallback;
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  return [x1, y1, x2, y2].every(Number.isFinite) ? cubicBezier(clamp01(x1), y1, clamp01(x2), y2) : fallback;
}

export type Tween = { from: number; to: number; start: number; duration: number; ease: Ease };

/* A tween from where the value is now; a reversal mid-way takes only the share of the full duration that is left to travel, so hovering in and out never jumps. */
export function startTween(current: number, to: number, now: number, fullDuration: number, ease: Ease): Tween {
  return { from: current, to, start: now, duration: Math.max(0, fullDuration * Math.abs(to - current)), ease };
}

export function tweenAt(tween: Tween, now: number): { value: number; done: boolean } {
  if (tween.duration <= 0) return { value: tween.to, done: true };
  const t = clamp01((now - tween.start) / tween.duration);
  return { value: tween.from + (tween.to - tween.from) * tween.ease(t), done: t >= 1 };
}

export type Scrub = "through" | "in";

/* Openness from a sheet's center position in its scroller, 0 at the top and 1 at the bottom: `through` lies flat in the middle and crumples toward both edges, `in` opens on the way in and stays flat above. */
export function scrollOpenness(position: number, scrub: Scrub): number {
  if (scrub === "in") return 1 - smoothstep(0.45, 0.95, position);
  const distance = Math.abs(position - 0.5) / 0.5;
  return 1 - smoothstep(0.25, 0.85, distance);
}

/* A spring that has come to rest within `rest`. */
export const springAtRest = (state: SpringState, target: number, rest = 1e-3) => Math.abs(state.value - target) < rest && Math.abs(state.velocity) < rest * 10;

/* One frame of a spring toward its target, in place; returns true while it still moves. */
export function advanceSpring(state: SpringState, target: number, spring: Spring, seconds: number, rest = 1e-3): boolean {
  const next = stepSpring(state, target, spring, seconds);
  if (springAtRest(next, target, rest)) {
    state.value = target;
    state.velocity = 0;
    return false;
  }
  state.value = next.value;
  state.velocity = next.velocity;
  return true;
}

/* The starting velocity that sends a spring at rest at 0 to `depth` and back, for the closing squeeze: a near-critically damped spring released with velocity v peaks near v / (omega e). */
export function squeezeVelocity(spring: Spring, depth: number): number {
  const omega = Math.sqrt(spring.stiffness / (spring.mass ?? 1));
  return depth * omega * Math.E;
}
