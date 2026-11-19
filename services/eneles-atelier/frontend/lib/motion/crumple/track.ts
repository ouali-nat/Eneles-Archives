import type { CrumpleRecording } from "@/lib/motion/crumple/simulation";
import { between, random, sign, streamSeed } from "@/lib/motion/crumple/hash";

/* A crumple recording turned into something the reveal can play: an arc-length table so the visible change is spread evenly over the reveal (the near-still holding frames take almost no time), ambient occlusion per frame, the ball's resting orientation, and the render grid (the simulation grid upsampled twice per axis through precomputed stencils). Sampling blends Catmull-Rom between the four nearest frames. Everything here is pure and allocation-free per frame once a track and its scratch buffers exist. */

export type Quaternion = [number, number, number, number];

export type CrumpleTrack = {
  cols: number;
  rows: number;
  width: number;
  height: number;
  frames: Float32Array[];
  ao: Float32Array[];
  /* Normalized cumulative arc length per frame: 0 at the flat sheet, 1 at the ball. */
  arc: Float32Array;
  /* The ball's resting orientation and the yaw it unwinds while opening, in radians. */
  ballRotation: Quaternion;
  spin: number;
  /* The radius of the ball's silhouette seen from above as it rests, in material units. */
  ballRadius: number;
  /* The simulation grid's 8-neighbor edges and their flat lengths, for strain limiting during playback. */
  edges: { a: Int32Array; b: Int32Array; rest: Float32Array };
};

/* Playback strain limiting (after Provot, "Deformation Constraints in a Mass-Spring Model to Describe Rigid Cloth Behavior", 1995): a few Gauss-Seidel sweeps that bring every edge back within this slack of its flat length. Blending recorded frames shortens edges that turn between them and Catmull-Rom overshoots, so without it a few facets of a sampled pose stretch or squash by tens of percent for a frame (measured in Node over six shapes, folds, and ratios: with this and the solver's extra stretch sweeps the worst edge over a whole reveal went from 38 to 69% to 10 to 16%, at about 0.2 ms a frame, and layers stayed apart). */
const STRAIN_SLACK = 0.02;
const STRAIN_SWEEPS = 4;

/* The ball's camera-facing outer surface is chosen to be about this share front side, so some writing shows on it, and the ball rests on its flattest side (its shortest principal axis upright), as a crumpled ball on a desk does; the second weighs against the first. */
const FRONT_SHARE = 0.62;
const RESTING_WEIGHT = 0.35;
const ORIENTATION_TRIES = 48;
const SPIN_DEGREES = [20, 50] as const;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

/* Quaternions, (x, y, z, w). */
export function rotateVector(q: Quaternion, x: number, y: number, z: number, out: Float32Array | number[], offset: number) {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[offset] = x + qw * tx + (qy * tz - qz * ty);
  out[offset + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[offset + 2] = z + qw * tz + (qx * ty - qy * tx);
}

export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

export function slerpFromIdentity(q: Quaternion, t: number): Quaternion {
  let [x, y, z, w] = q;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const angle = Math.acos(Math.min(1, w));
  if (angle < 1e-5) return [0, 0, 0, 1];
  const s = Math.sin(angle * t) / Math.sin(angle);
  return [x * s, y * s, z * s, Math.cos(angle * t)];
}

export const yaw = (radians: number): Quaternion => [0, 0, Math.sin(radians / 2), Math.cos(radians / 2)];

/* A uniformly random rotation (Shoemake's method). */
function randomRotation(next: () => number): Quaternion {
  const u1 = next();
  const u2 = next() * Math.PI * 2;
  const u3 = next() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

/* Triangles of a grid, diagonals alternating by cell parity so folds have no directional bias; counter-clockwise seen from the front (+z). */
export function gridIndex(cols: number, rows: number): Uint32Array {
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let at = 0;
  for (let j = 0; j < rows - 1; j += 1)
    for (let i = 0; i < cols - 1; i += 1) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if ((i + j) % 2 === 0) index.set([a, b, d, a, d, c], at);
      else index.set([a, b, c, b, d, c], at);
      at += 6;
    }
  return index;
}

/* Area-weighted vertex normals of the front side. */
export function computeNormals(positions: Float32Array, index: Uint32Array, out: Float32Array) {
  out.fill(0);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v] += nx;
      out[v + 1] += ny;
      out[v + 2] += nz;
    }
  }
  for (let v = 0; v < out.length; v += 3) {
    const length = Math.hypot(out[v], out[v + 1], out[v + 2]) || 1;
    out[v] /= length;
    out[v + 1] /= length;
    out[v + 2] /= length;
  }
}

/* Upsamples a grid of `components`-wide values twice per axis: even samples copy the grid, odd ones blend a plain midpoint with a four-point cubic (Catmull-Rom at the half) by `cubic`, ends extrapolated linearly. `scratch` holds (2 cols - 1) x rows values. */
export function upsampleGrid(source: Float32Array, cols: number, rows: number, components: number, cubic: number, scratch: Float32Array, out: Float32Array) {
  const wide = 2 * cols - 1;
  const at = (array: Float32Array, stride: number, n: number, base: number, k: number, c: number) => {
    if (k < 0) return 2 * array[base + c] - array[base + stride + c];
    if (k >= n) return 2 * array[base + (n - 1) * stride + c] - array[base + (n - 2) * stride + c];
    return array[base + k * stride + c];
  };
  for (let j = 0; j < rows; j += 1) {
    const base = j * cols * components;
    const outBase = j * wide * components;
    for (let i = 0; i < cols; i += 1)
      for (let c = 0; c < components; c += 1) {
        scratch[outBase + 2 * i * components + c] = source[base + i * components + c];
        if (i === cols - 1) continue;
        const p0 = at(source, components, cols, base, i - 1, c);
        const p1 = source[base + i * components + c];
        const p2 = source[base + (i + 1) * components + c];
        const p3 = at(source, components, cols, base, i + 2, c);
        scratch[outBase + (2 * i + 1) * components + c] = 0.5 * (p1 + p2) + cubic * ((-p0 + p1 + p2 - p3) / 16);
      }
  }
  const stride = wide * components;
  for (let i = 0; i < wide; i += 1)
    for (let j = 0; j < rows; j += 1)
      for (let c = 0; c < components; c += 1) {
        const column = i * components;
        out[2 * j * stride + column + c] = scratch[j * stride + column + c];
        if (j === rows - 1) continue;
        const p0 = at(scratch, stride, rows, column, j - 1, c);
        const p1 = scratch[j * stride + column + c];
        const p2 = scratch[(j + 1) * stride + column + c];
        const p3 = at(scratch, stride, rows, column, j + 2, c);
        out[(2 * j + 1) * stride + column + c] = 0.5 * (p1 + p2) + cubic * ((-p0 + p1 + p2 - p3) / 16);
      }
}

/* The flat sheet's simulation-grid positions (the first frame of every recording), for a sheet whose track is not built yet. */
export function flatGrid(cols: number, rows: number, width: number, height: number): Float32Array {
  const out = new Float32Array(cols * rows * 3);
  for (let j = 0; j < rows; j += 1)
    for (let i = 0; i < cols; i += 1) {
      const p = (j * cols + i) * 3;
      out[p] = (i / (cols - 1) - 0.5) * width;
      out[p + 1] = (j / (rows - 1) - 0.5) * height;
    }
  return out;
}

/* The shortest principal axis of a point cloud centered at the origin: the eigenvector of its covariance with the smallest eigenvalue, by Jacobi rotations. */
function shortestAxis(frame: Float32Array): [number, number, number] {
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const count = frame.length / 3;
  for (let p = 0; p < count; p += 1)
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) a[i * 3 + j] += (frame[p * 3 + i] * frame[p * 3 + j]) / count;
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 24; sweep += 1)
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-12) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k * 3 + p];
        const akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p * 3 + k];
        const aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  const smallest = [0, 1, 2].reduce((best, i) => (a[i * 4] < a[best * 4] ? i : best), 0);
  return [v[smallest], v[3 + smallest], v[6 + smallest]];
}

function percentileRadius(frame: Float32Array, fraction: number) {
  const radii = new Float32Array(frame.length / 3);
  for (let p = 0; p < radii.length; p += 1) radii[p] = Math.hypot(frame[p * 3], frame[p * 3 + 1], frame[p * 3 + 2]);
  radii.sort();
  return radii[Math.min(radii.length - 1, Math.floor(radii.length * fraction))];
}

export function buildTrack(recording: CrumpleRecording, shape: number): CrumpleTrack {
  const { cols, rows, width, height, frames, buried } = recording;
  const count = cols * rows;
  const last = frames[frames.length - 1];

  /* Arc length: mean particle displacement between consecutive frames. */
  const arc = new Float32Array(frames.length);
  for (let k = 1; k < frames.length; k += 1) {
    let sum = 0;
    for (let p = 0; p < count; p += 1) sum += Math.hypot(frames[k][p * 3] - frames[k - 1][p * 3], frames[k][p * 3 + 1] - frames[k - 1][p * 3 + 1], frames[k][p * 3 + 2] - frames[k - 1][p * 3 + 2]);
    arc[k] = arc[k - 1] + sum / count + 1e-6;
  }
  for (let k = 0; k < arc.length; k += 1) arc[k] /= arc[arc.length - 1];

  /* Ambient occlusion: buried particles and, once the sheet is a ball, those near its middle. */
  const flatRadius = percentileRadius(frames[0], 0.95);
  const ballRadius = percentileRadius(last, 0.95);
  const ao = frames.map((frame, k) => {
    const radius = percentileRadius(frame, 0.95);
    const ballness = smoothstep(0, 1, (flatRadius - radius) / Math.max(1e-6, flatRadius - ballRadius));
    const out = new Float32Array(count);
    for (let p = 0; p < count; p += 1) {
      const r = Math.hypot(frame[p * 3], frame[p * 3 + 1], frame[p * 3 + 2]);
      const depth = 1 - 0.7 * smoothstep(3, 14, buried[k][p]);
      const core = 0.55 + 0.45 * smoothstep(0.5 * radius, radius, r);
      out[p] = depth * (1 + (core - 1) * ballness);
    }
    return out;
  });

  /* Orientation: of a few seeded rotations of the ball, the one whose camera-facing outer surface is closest to the front share. */
  const next = random(streamSeed(shape, 7));
  const index = gridIndex(cols, rows);
  const lastAo = ao[ao.length - 1];
  const flattest = shortestAxis(last);
  let best: Quaternion = [0, 0, 0, 1];
  let bestError = Infinity;
  const n = [0, 0, 0];
  const c = [0, 0, 0];
  const up = [0, 0, 0];
  for (let attempt = 0; attempt < ORIENTATION_TRIES; attempt += 1) {
    const q = randomRotation(next);
    let front = 0;
    let total = 0;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3;
      const b = index[t + 1] * 3;
      const d = index[t + 2] * 3;
      const ux = last[b] - last[a];
      const uy = last[b + 1] - last[a + 1];
      const uz = last[b + 2] - last[a + 2];
      const vx = last[d] - last[a];
      const vy = last[d + 1] - last[a + 1];
      const vz = last[d + 2] - last[a + 2];
      rotateVector(q, uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, n, 0);
      rotateVector(q, (last[a] + last[b] + last[d]) / 3, (last[a + 1] + last[b + 1] + last[d + 1]) / 3, (last[a + 2] + last[b + 2] + last[d + 2]) / 3, c, 0);
      if (c[2] <= 0) continue;
      const shade = (lastAo[index[t]] + lastAo[index[t + 1]] + lastAo[index[t + 2]]) / 3;
      const weight = Math.abs(n[2]) * shade * (c[2] / ballRadius);
      total += weight;
      if (n[2] > 0) front += weight;
    }
    rotateVector(q, flattest[0], flattest[1], flattest[2], up, 0);
    const error = Math.abs((total > 0 ? front / total : 0) - FRONT_SHARE) + RESTING_WEIGHT * (1 - Math.abs(up[2]));
    if (error < bestError) {
      bestError = error;
      best = q;
    }
  }
  const spinNext = random(streamSeed(shape, 8));
  const spin = sign(spinNext) * ((between(spinNext, SPIN_DEGREES[0], SPIN_DEGREES[1]) * Math.PI) / 180);
  /* The ball is sized by its silhouette seen from above, as it rests. */
  const footprint = new Float32Array(count);
  for (let p = 0; p < count; p += 1) {
    rotateVector(best, last[p * 3], last[p * 3 + 1], last[p * 3 + 2], c, 0);
    footprint[p] = Math.hypot(c[0], c[1]);
  }
  footprint.sort();
  const silhouette = footprint[Math.min(count - 1, Math.floor(count * 0.95))];
  return { cols, rows, width, height, frames, ao, arc, ballRotation: best, spin, ballRadius: silhouette || ballRadius, edges: gridEdges(cols, rows, width, height) };
}

function gridEdges(cols: number, rows: number, width: number, height: number): CrumpleTrack["edges"] {
  const a: number[] = [];
  const b: number[] = [];
  const rest: number[] = [];
  const stepX = width / (cols - 1);
  const stepY = height / (rows - 1);
  for (let j = 0; j < rows; j += 1)
    for (let i = 0; i < cols; i += 1)
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ]) {
        const i1 = i + di;
        const j1 = j + dj;
        if (i1 >= cols || j1 < 0 || j1 >= rows) continue;
        a.push(j * cols + i);
        b.push(j1 * cols + i1);
        rest.push(Math.hypot(di * stepX, dj * stepY));
      }
  return { a: Int32Array.from(a), b: Int32Array.from(b), rest: Float32Array.from(rest) };
}

/* Brings a sampled pose's edges back within the slack of their flat lengths, in place, sweeping forward and backward in turn so no corner of the sheet is favored. */
export function limitStrain(track: CrumpleTrack, positions: Float32Array) {
  const { a: ends, b: others, rest } = track.edges;
  const count = ends.length;
  for (let sweep = 0; sweep < STRAIN_SWEEPS; sweep += 1)
    for (let step = 0; step < count; step += 1) {
      const k = sweep % 2 ? count - 1 - step : step;
      const a = ends[k] * 3;
      const b = others[k] * 3;
      const dx = positions[a] - positions[b];
      const dy = positions[a + 1] - positions[b + 1];
      const dz = positions[a + 2] - positions[b + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const low = rest[k] * (1 - STRAIN_SLACK);
      const high = rest[k] * (1 + STRAIN_SLACK);
      const goal = d > high ? high : d < low ? low : d;
      if (goal === d) continue;
      const s = (0.5 * (d - goal)) / d;
      positions[a] -= dx * s;
      positions[a + 1] -= dy * s;
      positions[a + 2] -= dz * s;
      positions[b] += dx * s;
      positions[b + 1] += dy * s;
      positions[b + 2] += dz * s;
    }
}

/* The fractional frame for a reveal parameter tau (0 flat, 1 ball) through the arc-length table. */
export function arcFrame(track: CrumpleTrack, tau: number): number {
  const { arc } = track;
  const t = clamp01(tau);
  let k = 1;
  while (k < arc.length - 1 && arc[k] < t) k += 1;
  const span = arc[k] - arc[k - 1];
  return k - 1 + (span > 0 ? clamp01((t - arc[k - 1]) / span) : 0);
}

/* Positions and occlusion of the simulation grid at tau: Catmull-Rom across the four nearest frames, clamped at the ends. */
export function sampleTrack(track: CrumpleTrack, tau: number, positions: Float32Array, occlusion: Float32Array) {
  const { frames, ao } = track;
  const f = arcFrame(track, tau);
  const last = frames.length - 1;
  const k = Math.min(last, Math.floor(f));
  const t = f - k;
  const i0 = Math.max(0, k - 1);
  const i1 = k;
  const i2 = Math.min(last, k + 1);
  const i3 = Math.min(last, k + 2);
  const t2 = t * t;
  const t3 = t2 * t;
  const w0 = 0.5 * (-t3 + 2 * t2 - t);
  const w1 = 0.5 * (3 * t3 - 5 * t2 + 2);
  const w2 = 0.5 * (-3 * t3 + 4 * t2 + t);
  const w3 = 0.5 * (t3 - t2);
  const [f0, f1, f2, f3] = [frames[i0], frames[i1], frames[i2], frames[i3]];
  for (let v = 0; v < positions.length; v += 1) positions[v] = w0 * f0[v] + w1 * f1[v] + w2 * f2[v] + w3 * f3[v];
  const [a1, a2] = [ao[i1], ao[i2]];
  for (let p = 0; p < occlusion.length; p += 1) occlusion[p] = a1[p] + (a2[p] - a1[p]) * t;
}
