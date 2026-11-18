/* A small spring kit for motion that follows moving targets frame by frame: a spring is stiffness and damping over mass (only k/m and c/m matter, so mass defaults to 1), it has no true duration, only a settling threshold. Used by the crumpled paper reveal for its scrub, lamp, landing settle, and closing squeeze. */

export type Spring = { stiffness: number; damping: number; mass?: number };

/* Presets, named for what they feel like. Snappy and smooth are close to critically damped (no visible overshoot); bouncy overshoots once; gentle is slow and soft for large travel. */
export const springs = {
  snappy: { stiffness: 520, damping: 42 },
  smooth: { stiffness: 260, damping: 30 },
  bouncy: { stiffness: 320, damping: 17 },
  gentle: { stiffness: 140, damping: 22 },
} as const satisfies Record<string, Spring>;
export type SpringName = keyof typeof springs;

export type SpringState = { value: number; velocity: number };

/* One frame of a value chasing `target`, integrated in fixed 1/240 s steps (semi-implicit Euler) so a long frame never makes it explode. */
export function stepSpring(state: SpringState, target: number, spring: Spring, seconds: number): SpringState {
  const { stiffness, damping, mass = 1 } = spring;
  const h = 1 / 240;
  let { value, velocity } = state;
  for (let left = Math.min(seconds, 1 / 15); left > 1e-6; left -= h) {
    const dt = Math.min(h, left);
    velocity += ((-stiffness * (value - target) - damping * velocity) / mass) * dt;
    value += velocity * dt;
  }
  return { value, velocity };
}

/* True where a fine pointer can hover, so pointer-following effects stay off on touch screens. An input capability, not a width. */
export function canHover(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
