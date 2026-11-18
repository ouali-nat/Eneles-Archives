import { between, integerBetween, random, sign, streamSeed } from "@/lib/motion/crumple/hash";

/* The crease field's seeded parameters, shared by the GPU crease map (shaders.ts draws the Voronoi facets and these lines) and the solver (simulation.ts pre-creases its hinges along the same lines), so the ball folds where the flat sheet later shows its strongest creases. Coordinates are material units: origin at the sheet's bottom-left corner, x right, y up, the long side 1. */

export type Fold = "none" | "half" | "thirds";

export type CreaseLine = {
  /* A point on the line and its unit direction. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  /* Half the segment's length; letter folds cross the whole sheet. */
  half: number;
  /* Slope jump across the line, seen from the front: positive is a valley, negative a ridge. */
  jump: number;
  /* Major folds die out over the last fifth of their length, like a d-cone; letter folds do not. */
  taper: boolean;
  /* Half-width of the rounded fold in sheet pixels; 0 uses the facet layers' coarse width. */
  width: number;
};

export type CreaseSpec = {
  seed: number;
  width: number;
  height: number;
  lines: CreaseLine[];
};

/* Facet layers of the crease map: cells across the long side and the largest tilt of a facet (large facets tilt less, because a sheet smoothed out by hand lies nearly flat at large scale). */
export const FACET_LAYERS = [
  { cells: 4.5, slope: 0.018 },
  { cells: 9, slope: 0.03 },
  { cells: 19, slope: 0.042 },
  { cells: 38, slope: 0.05 },
] as const;

/* Three to five major folds; their slope jump range; letter folds. */
const MAJOR_COUNT = [3, 5] as const;
const MAJOR_JUMP = [0.05, 0.09] as const;
const MAJOR_HALF_LENGTH = [0.25, 0.7] as const;
const LETTER_JUMP = 0.07;
const LETTER_WIDTH = 1.2;
export const MAX_CREASE_LINES = 8;

export function creaseSpec(shape: number, fold: Fold, width: number, height: number): CreaseSpec {
  const seed = streamSeed(shape, 11);
  const next = random(streamSeed(shape, 3));
  const lines: CreaseLine[] = [];
  const count = integerBetween(next, MAJOR_COUNT[0], MAJOR_COUNT[1]);
  for (let index = 0; index < count; index += 1) {
    const angle = next() * Math.PI;
    lines.push({
      x: width * between(next, 0.18, 0.82),
      y: height * between(next, 0.18, 0.82),
      dx: Math.cos(angle),
      dy: Math.sin(angle),
      half: between(next, MAJOR_HALF_LENGTH[0], MAJOR_HALF_LENGTH[1]),
      jump: sign(next) * between(next, MAJOR_JUMP[0], MAJOR_JUMP[1]),
      taper: true,
      width: 0,
    });
  }
  for (const v of letterFolds(fold)) lines.push({ x: 0, y: v * height, dx: 1, dy: 0, half: 4, jump: LETTER_JUMP, taper: false, width: LETTER_WIDTH });
  return { seed, width, height, lines: lines.slice(0, MAX_CREASE_LINES) };
}

/* Heights of the letter folds as fractions of the sheet's height, from the bottom. */
export function letterFolds(fold: Fold): number[] {
  return fold === "half" ? [0.5] : fold === "thirds" ? [1 / 3, 2 / 3] : [];
}

/* True when a hinge whose middle particle sits at (x, y) and which runs along (hx, hy) crosses one of the spec's lines within `tolerance`: those hinges start creased in the solver. A hinge running along a line does not fold across it. */
export function nearCrease(x: number, y: number, hx: number, hy: number, spec: CreaseSpec, tolerance: number): boolean {
  const length = Math.hypot(hx, hy) || 1;
  for (const line of spec.lines) {
    const rx = x - line.x;
    const ry = y - line.y;
    const along = rx * line.dx + ry * line.dy;
    const across = -rx * line.dy + ry * line.dx;
    if (Math.abs(across) > tolerance || Math.abs(along) > line.half * (line.taper ? 0.85 : 1)) continue;
    const crossing = Math.abs((-hx * line.dy + hy * line.dx) / length);
    if (crossing > 0.5) return true;
  }
  return false;
}

/* The lines packed for the crease-map shader: per line (x, y, dx, dy) and (half, jump, taper, width). */
export function creaseUniforms(spec: CreaseSpec): { count: number; a: number[][]; b: number[][] } {
  const a: number[][] = [];
  const b: number[][] = [];
  for (let index = 0; index < MAX_CREASE_LINES; index += 1) {
    const line = spec.lines[index];
    a.push(line ? [line.x, line.y, line.dx, line.dy] : [0, 0, 1, 0]);
    b.push(line ? [line.half, line.jump, line.taper ? 1 : 0, line.width] : [0, 0, 0, 0]);
  }
  return { count: spec.lines.length, a, b };
}
