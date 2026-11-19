/* Seeded randomness for the crumple engine. The integer hash is PCG's output permutation as recommended by Jarzynski and Olano, "Hash Functions for GPU Rendering" (JCGT 2020); the TypeScript and GLSL versions below are bit-identical (32-bit wrapping multiplies through Math.imul, unsigned results through `>>> 0`), so a value hashed on the CPU matches the same value hashed in a shader. */

/* One round of the PCG hash on an unsigned 32-bit integer. */
export function pcg(value: number): number {
  const state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/* Hash of a lattice point and a seed, as an unsigned integer. Negative coordinates wrap the way GLSL's uint(int) does. */
export function hash3(x: number, y: number, seed: number): number {
  return pcg(((x >>> 0) + pcg(((y >>> 0) + pcg(seed >>> 0)) >>> 0)) >>> 0);
}

/* The same as a float in [0, 1). */
export const hashUnit = (x: number, y: number, seed: number) => hash3(x, y, seed) / 4294967296;

/* A seeded stream of floats in [0, 1): the n-th draw is the hash of (n, seed), so a stream never depends on how many draws another stream made. */
export function random(seed: number): () => number {
  let index = 0;
  const base = pcg(seed >>> 0);
  return () => pcg((base + pcg(index++)) >>> 0) / 4294967296;
}

/* A stream's helpers: a float in a range, an integer in [low, high], and a sign. */
export const between = (next: () => number, low: number, high: number) => low + (high - low) * next();
export const integerBetween = (next: () => number, low: number, high: number) => Math.min(high, low + Math.floor((high - low + 1) * next()));
export const sign = (next: () => number) => (next() < 0.5 ? -1 : 1);

/* The seed of one named stream for a sheet shape, so the bow, the pinches, and the folds of a shape draw from independent streams. */
export const streamSeed = (shape: number, stream: number) => pcg((Math.imul(shape >>> 0, 2654435761) ^ pcg(stream)) >>> 0);

/* GLSL ES 3.00 source of the same hash, for the shaders' prelude. */
export const pcgGlsl = /* glsl */ `
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
uint hash3u(int x, int y, uint seed) {
  return pcg(uint(x) + pcg(uint(y) + pcg(seed)));
}
float hash3(int x, int y, uint seed) {
  return float(hash3u(x, y, seed) >> 8u) * (1.0 / 16777216.0);
}
vec2 hash3v(int x, int y, uint seed) {
  uint h = hash3u(x, y, seed);
  return vec2(float(h >> 16u), float(h & 65535u)) * (1.0 / 65536.0);
}
`;
