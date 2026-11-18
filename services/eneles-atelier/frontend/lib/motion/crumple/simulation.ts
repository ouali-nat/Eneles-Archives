import { creaseSpec, nearCrease, type Fold } from "@/lib/motion/crumple/creases";
import { between, hashUnit, integerBetween, random, streamSeed } from "@/lib/motion/crumple/hash";

/* The crumple: a sheet of paper squeezed into a ball by a pair of hands, solved once per shape, fold, and grid with extended position-based dynamics (XPBD, after Macklin, Muller, and Chentanez, "XPBD: Position-Based Simulation of Compliant Constrained Dynamics", 2016, in its small-steps form: many substeps of one Gauss-Seidel sweep each, multipliers reset every substep). The reveal plays the recording backward, so every state a reader sees while the sheet opens is a state real paper could be in: inextensible, self-avoiding, and creased where it was bent hard.

What makes it paper rather than cloth is plastic bending: a hinge (a distance constraint two cells long) is stiff while it bends a little and, once its chord shortens past the yield, creases for good, becoming soft and taking its bent chord as its new rest, so the sheet ends as flat facets meeting at sharp ridges. The hands are a tumbling ellipsoid that shrinks to the ball's final size, three seeded pinches make the deep tucks of a real ball, and hinges on the seeded major folds and letter folds start creased so the sheet folds where the flat sheet's crease map later shows its strongest lines.

This module is pure and DOM-free: the job is a generator the engine time-slices (it yields after every substep), and a module Worker could host it unchanged. Every tuning constant is named here. Normalized units: the sheet's long side is 1, all inverse masses are 1. */

export type CrumpleRecording = {
  cols: number;
  rows: number;
  /* The sheet's size in material units (the long side is 1). */
  width: number;
  height: number;
  /* Positions every few steps, centered on the sheet's centroid, three floats per particle; the first frame is the flat sheet and the last the settled ball. */
  frames: Float32Array[];
  /* Per frame and particle, how many particles that are not its grid neighbors lie within the burial radius: how deep inside the ball it is. */
  buried: Float32Array[];
  /* The container's final radius and the contact distance, in material units. */
  radius: number;
  contact: number;
};

/* Steps and timing: compress, then hold while the ball settles; four substeps per step. */
const STEPS_COMPRESS = 200;
const STEPS_HOLD = 40;
const SUBSTEPS = 4;
const STEP_SECONDS = 1 / 60;
const CAPTURE_EVERY = 8;

/* Paper. Bending compliance over h squared while elastic and once creased, the chord compression at which a hinge yields (about a 32 degree bend), and how far a creased hinge's rest chord flows toward its bent chord per substep. */
const BEND_ELASTIC = 0.35;
const BEND_CREASED = 12;
const YIELD = 0.04;
const PLASTIC_FLOW = 0.5;
/* Hinges on a seeded fold start creased and pre-bent by this angle. */
const PRECREASE_DEGREES = 20;
const PRECREASE_REACH = 0.6;

/* Self contact: the contact distance as a fraction of a cell (wider than half a cell's diagonal, so a layer cannot slip through the middle of a cell), friction between layers, and the neighbor list's reach and rebuild interval. */
const CONTACT_CELLS = 0.8;
const CONTACT_FRICTION = 0.35;
const LIST_REACH = 1.6;
const LIST_EVERY = 3;
const HASH_BUCKETS = 1 << 13;
const BURIAL_REACH = 2.2;

/* The hands: an ellipsoid with these relative semi-axes, tumbling at this rate (radians per second), with wall friction; it eases from its starting radius to the radius that packs the sheet at this volume fraction. */
const CONTAINER_AXES = [1, 0.88, 0.8] as const;
const CONTAINER_START = 0.72;
const CONTAINER_SPIN = 0.4;
const WALL_FRICTION = 0.6;
const PACKING = 0.3;

/* Pinches: a disk of the sheet pulled toward the middle of the ball for a moment, which makes the deep tucks. */
const PINCH_COUNT = 3;
const PINCH_WINDOW = [24, 150] as const;
const PINCH_RADIUS = 0.11;
const PINCH_ACCELERATION = 5;
const PINCH_STEPS = 18;

/* The sheet's initial bow (two seeded plane waves, so the first buckle is a taco or a saddle rather than numerical noise) and a little value noise. */
const BOW = 0.014;
const BOW_CYCLES = [0.8, 1.6] as const;
const BOW_NOISE = 0.004;

/* Velocity kept per substep while compressing and while holding. */
const DAMPING_COMPRESS = 0.996;
const DAMPING_HOLD = 0.97;

/* Stretch sweeps after the hands each substep, so their push and the contacts do not leave the paper stretched in its plane. */
const STRETCH_AFTER_HANDS = 3;

/* Particles along the long side of the simulation grid; the short side gets as many as keep the cells square. */
export const GRID_LONG = 44;

export function gridFor(aspect: number): { cols: number; rows: number; width: number; height: number } {
  const landscape = aspect >= 1;
  const short = Math.max(6, Math.round(GRID_LONG * (landscape ? 1 / aspect : aspect)));
  return landscape ? { cols: GRID_LONG, rows: short, width: 1, height: 1 / aspect } : { cols: short, rows: GRID_LONG, width: aspect, height: 1 };
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t: number) => t * t * (3 - 2 * t);

/* Value noise on a unit lattice, for the bow. */
function valueNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hashUnit(ix, iy, seed);
  const b = hashUnit(ix + 1, iy, seed);
  const c = hashUnit(ix, iy + 1, seed);
  const d = hashUnit(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const bucketOf = (cx: number, cy: number, cz: number) => ((Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) >>> 0) & (HASH_BUCKETS - 1);

/* A spatial hash over the particles, rebuilt in place: bucket starts and the particles sorted by bucket. */
type SpatialHash = { cell: number; starts: Int32Array; entries: Int32Array; cursor: Int32Array };

function makeHash(count: number, cell: number): SpatialHash {
  return { cell, starts: new Int32Array(HASH_BUCKETS + 1), entries: new Int32Array(count), cursor: new Int32Array(HASH_BUCKETS) };
}

function fillHash(hash: SpatialHash, x: Float64Array, count: number, buckets: Int32Array) {
  const { cell, starts, entries, cursor } = hash;
  starts.fill(0);
  for (let p = 0; p < count; p += 1) {
    const bucket = bucketOf(Math.floor(x[p * 3] / cell), Math.floor(x[p * 3 + 1] / cell), Math.floor(x[p * 3 + 2] / cell));
    buckets[p] = bucket;
    starts[bucket + 1] += 1;
  }
  for (let b = 0; b < HASH_BUCKETS; b += 1) starts[b + 1] += starts[b];
  cursor.set(starts.subarray(0, HASH_BUCKETS));
  for (let p = 0; p < count; p += 1) entries[cursor[buckets[p]]++] = p;
}

/* Calls `visit(q)` once for every particle in the 27 cells around particle p (each bucket once, even when two cells share one). */
function forNear(hash: SpatialHash, x: Float64Array, p: number, seen: Int32Array, visit: (q: number) => void) {
  const { cell, starts, entries } = hash;
  const cx = Math.floor(x[p * 3] / cell);
  const cy = Math.floor(x[p * 3 + 1] / cell);
  const cz = Math.floor(x[p * 3 + 2] / cell);
  let used = 0;
  for (let dz = -1; dz <= 1; dz += 1)
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const bucket = bucketOf(cx + dx, cy + dy, cz + dz);
        let repeat = false;
        for (let k = 0; k < used; k += 1) if (seen[k] === bucket) repeat = true;
        if (repeat) continue;
        seen[used++] = bucket;
        for (let e = starts[bucket]; e < starts[bucket + 1]; e += 1) visit(entries[e]);
      }
}

/* Rotation matrix (row-major 3x3) about a unit axis. */
function rotation(axis: readonly [number, number, number], angle: number, out: Float64Array) {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  out[0] = t * x * x + c;
  out[1] = t * x * y - s * z;
  out[2] = t * x * z + s * y;
  out[3] = t * x * y + s * z;
  out[4] = t * y * y + c;
  out[5] = t * y * z - s * x;
  out[6] = t * x * z - s * y;
  out[7] = t * y * z + s * x;
  out[8] = t * z * z + c;
}

export function* crumpleJob(shape: number, fold: Fold, cols: number, rows: number, width: number, height: number): Generator<number, CrumpleRecording, void> {
  const count = cols * rows;
  const cell = 1 / (Math.max(cols, rows) - 1);
  const stepX = width / (cols - 1);
  const stepY = height / (rows - 1);
  const contact = CONTACT_CELLS * cell;
  const spec = creaseSpec(shape, fold, width, height);
  const gi = new Int16Array(count);
  const gj = new Int16Array(count);
  const x = new Float64Array(count * 3);
  const prev = new Float64Array(count * 3);
  const accel = new Float64Array(count * 3);

  /* The flat sheet, centered, then bowed. */
  const bowNext = random(streamSeed(shape, 1));
  const waves = [0, 1].map(() => {
    const angle = bowNext() * Math.PI * 2;
    return { dx: Math.cos(angle), dy: Math.sin(angle), cycles: between(bowNext, BOW_CYCLES[0], BOW_CYCLES[1]), phase: bowNext() * Math.PI * 2 };
  });
  const noiseSeed = streamSeed(shape, 2);
  const flat = new Float32Array(count * 3);
  for (let j = 0; j < rows; j += 1)
    for (let i = 0; i < cols; i += 1) {
      const p = j * cols + i;
      gi[p] = i;
      gj[p] = j;
      const mx = i * stepX;
      const my = j * stepY;
      let z = 0;
      for (const wave of waves) z += 0.5 * Math.sin(Math.PI * 2 * wave.cycles * (wave.dx * mx + wave.dy * my) + wave.phase);
      z = BOW * z + BOW_NOISE * (valueNoise(mx * 6, my * 6, noiseSeed) - 0.5) * 2;
      x[p * 3] = mx - width / 2;
      x[p * 3 + 1] = my - height / 2;
      x[p * 3 + 2] = z;
      flat[p * 3] = mx - width / 2;
      flat[p * 3 + 1] = my - height / 2;
    }
  prev.set(x);

  /* Stretch: every 8-neighbor edge, hard. */
  const stretchA: number[] = [];
  const stretchB: number[] = [];
  /* Bending: hinges two cells long in four directions, with the middle particle's material position for pre-creasing. */
  const bendA: number[] = [];
  const bendB: number[] = [];
  const bendCreased: number[] = [];
  const bendRestScale: number[] = [];
  const precrease = Math.cos(((PRECREASE_DEGREES / 2) * Math.PI) / 180);
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const;
  for (let j = 0; j < rows; j += 1)
    for (let i = 0; i < cols; i += 1) {
      const p = j * cols + i;
      for (const [di, dj] of directions) {
        const i1 = i + di;
        const j1 = j + dj;
        if (i1 < cols && j1 >= 0 && j1 < rows) {
          stretchA.push(p);
          stretchB.push(j1 * cols + i1);
        }
        const i2 = i + 2 * di;
        const j2 = j + 2 * dj;
        if (i2 < cols && j2 >= 0 && j2 < rows) {
          bendA.push(p);
          bendB.push(j2 * cols + i2);
          const creased = nearCrease(i1 * stepX, j1 * stepY, di * stepX, dj * stepY, spec, PRECREASE_REACH * cell);
          bendCreased.push(creased ? 1 : 0);
          bendRestScale.push(creased ? precrease : 1);
        }
      }
    }
  const sA = Int32Array.from(stretchA);
  const sB = Int32Array.from(stretchB);
  const sRest = new Float64Array(sA.length);
  for (let k = 0; k < sA.length; k += 1) sRest[k] = Math.hypot(x[sA[k] * 3] - x[sB[k] * 3], x[sA[k] * 3 + 1] - x[sB[k] * 3 + 1]);
  const bA = Int32Array.from(bendA);
  const bB = Int32Array.from(bendB);
  const bCreased = Uint8Array.from(bendCreased);
  const bRest = new Float64Array(bA.length);
  for (let k = 0; k < bA.length; k += 1) bRest[k] = Math.hypot(x[bA[k] * 3] - x[bB[k] * 3], x[bA[k] * 3 + 1] - x[bB[k] * 3 + 1]) * bendRestScale[k];

  /* The hands. A portrait sheet's long side starts along the container's longest axis. */
  const axisNext = random(streamSeed(shape, 4));
  const theta = axisNext() * Math.PI * 2;
  const phi = Math.acos(2 * axisNext() - 1);
  const spin: [number, number, number] = [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)];
  const portrait = height > width;
  let fit = 0;
  for (const [cx, cy] of [
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ]) {
    const along = portrait ? cy : cx;
    const across = portrait ? cx : cy;
    fit = Math.max(fit, (along / CONTAINER_AXES[0]) ** 2 + (across / CONTAINER_AXES[1]) ** 2);
  }
  const startRadius = Math.max(CONTAINER_START, Math.sqrt(fit) * 1.06);
  /* The radius at which the ellipsoid (not a sphere: its axes are scaled down) holds the sheet at the packing fraction. */
  const endRadius = Math.cbrt((3 * width * height * contact) / (4 * Math.PI * PACKING * CONTAINER_AXES[0] * CONTAINER_AXES[1] * CONTAINER_AXES[2]));
  const turn = new Float64Array(9);
  const base = new Float64Array(9);
  rotation([0, 0, 1], portrait ? Math.PI / 2 : 0, base);
  const frame = new Float64Array(9);

  /* Pinches: a seeded material point, its disk of particles, and its window of steps. */
  const pinchNext = random(streamSeed(shape, 5));
  const pinches = Array.from({ length: PINCH_COUNT }, () => {
    const start = integerBetween(pinchNext, PINCH_WINDOW[0], PINCH_WINDOW[1] - PINCH_STEPS);
    const mx = width * between(pinchNext, 0.1, 0.9);
    const my = height * between(pinchNext, 0.1, 0.9);
    const members: number[] = [];
    for (let p = 0; p < count; p += 1) if (Math.hypot(gi[p] * stepX - mx, gj[p] * stepY - my) < PINCH_RADIUS) members.push(p);
    return { start, members: Int32Array.from(members) };
  });

  /* Contacts: pairs within the list's reach that are not already joined by constraints. */
  const listHash = makeHash(count, LIST_REACH * contact);
  const buckets = new Int32Array(count);
  const seen = new Int32Array(27);
  let pairA = new Int32Array(count * 16);
  let pairB = new Int32Array(count * 16);
  let pairs = 0;
  const reach2 = (LIST_REACH * contact) ** 2;
  const rebuildPairs = () => {
    fillHash(listHash, x, count, buckets);
    pairs = 0;
    for (let p = 0; p < count; p += 1) {
      const px = x[p * 3];
      const py = x[p * 3 + 1];
      const pz = x[p * 3 + 2];
      forNear(listHash, x, p, seen, (q) => {
        if (q <= p || (Math.abs(gi[p] - gi[q]) <= 2 && Math.abs(gj[p] - gj[q]) <= 2)) return;
        const dx = px - x[q * 3];
        const dy = py - x[q * 3 + 1];
        const dz = pz - x[q * 3 + 2];
        if (dx * dx + dy * dy + dz * dz > reach2) return;
        if (pairs === pairA.length) {
          const grownA = new Int32Array(pairs * 2);
          const grownB = new Int32Array(pairs * 2);
          grownA.set(pairA);
          grownB.set(pairB);
          pairA = grownA;
          pairB = grownB;
        }
        pairA[pairs] = p;
        pairB[pairs] = q;
        pairs += 1;
      });
    }
  };

  /* Burial: non-neighbors within the burial reach, for ambient occlusion. */
  const burialHash = makeHash(count, BURIAL_REACH * contact);
  const burial2 = (BURIAL_REACH * contact) ** 2;
  const measureBurial = () => {
    fillHash(burialHash, x, count, buckets);
    const out = new Float32Array(count);
    for (let p = 0; p < count; p += 1) {
      let n = 0;
      forNear(burialHash, x, p, seen, (q) => {
        if (q === p || (Math.abs(gi[p] - gi[q]) <= 2 && Math.abs(gj[p] - gj[q]) <= 2)) return;
        const dx = x[p * 3] - x[q * 3];
        const dy = x[p * 3 + 1] - x[q * 3 + 1];
        const dz = x[p * 3 + 2] - x[q * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < burial2) n += 1;
      });
      out[p] = n;
    }
    return out;
  };

  const frames: Float32Array[] = [flat];
  const buried: Float32Array[] = [new Float32Array(count)];
  const h = STEP_SECONDS / SUBSTEPS;
  const h2 = h * h;
  const totalSteps = STEPS_COMPRESS + STEPS_HOLD;
  const [ax, ay, az] = CONTAINER_AXES;

  /* Stretch, hard (compliance 0): one Gauss-Seidel sweep, half the error to each end. */
  const stretch = () => {
    for (let k = 0; k < sA.length; k += 1) {
      const a = sA[k] * 3;
      const b = sB[k] * 3;
      const dx = x[a] - x[b];
      const dy = x[a + 1] - x[b + 1];
      const dz = x[a + 2] - x[b + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const s = (0.5 * (d - sRest[k])) / d;
      x[a] -= dx * s;
      x[a + 1] -= dy * s;
      x[a + 2] -= dz * s;
      x[b] += dx * s;
      x[b + 1] += dy * s;
      x[b + 2] += dz * s;
    }
  };

  for (let step = 0; step < totalSteps; step += 1) {
    const compressing = step < STEPS_COMPRESS;
    const radius = startRadius + (endRadius - startRadius) * easeInOutCubic(Math.min(1, step / STEPS_COMPRESS));
    const ea = radius * ax;
    const eb = radius * ay;
    const ec = radius * az;
    const damping = compressing ? DAMPING_COMPRESS : DAMPING_HOLD;
    if (step % LIST_EVERY === 0) rebuildPairs();

    /* Pinch accelerations toward the middle of the ball (the centroid sits at the origin). */
    accel.fill(0);
    for (const pinch of pinches) {
      if (step < pinch.start || step >= pinch.start + PINCH_STEPS) continue;
      for (const p of pinch.members) {
        const length = Math.hypot(x[p * 3], x[p * 3 + 1], x[p * 3 + 2]) || 1;
        for (let k = 0; k < 3; k += 1) accel[p * 3 + k] -= (PINCH_ACCELERATION * x[p * 3 + k]) / length;
      }
    }

    for (let sub = 0; sub < SUBSTEPS; sub += 1) {
      /* The container's orientation this substep: its seeded tumble over the base orientation. */
      rotation(spin, CONTAINER_SPIN * (step * SUBSTEPS + sub) * h, turn);
      for (let r = 0; r < 3; r += 1)
        for (let c = 0; c < 3; c += 1) frame[r * 3 + c] = turn[r * 3] * base[c] + turn[r * 3 + 1] * base[3 + c] + turn[r * 3 + 2] * base[6 + c];

      for (let k = 0; k < count * 3; k += 1) {
        const velocity = (x[k] - prev[k]) * damping;
        prev[k] = x[k];
        x[k] += velocity + accel[k] * h2;
      }

      stretch();

      /* Bending with yield and plastic flow. */
      for (let k = 0; k < bA.length; k += 1) {
        const a = bA[k] * 3;
        const b = bB[k] * 3;
        const dx = x[a] - x[b];
        const dy = x[a + 1] - x[b + 1];
        const dz = x[a + 2] - x[b + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-9) continue;
        if (!bCreased[k] && d < bRest[k] * (1 - YIELD)) bCreased[k] = 1;
        if (bCreased[k]) {
          const target = d / (1 - YIELD);
          if (target < bRest[k]) bRest[k] += (target - bRest[k]) * PLASTIC_FLOW;
        }
        const compliance = bCreased[k] ? BEND_CREASED : BEND_ELASTIC;
        const s = (d - bRest[k]) / (2 + compliance) / d;
        x[a] -= dx * s;
        x[a + 1] -= dy * s;
        x[a + 2] -= dz * s;
        x[b] += dx * s;
        x[b + 1] += dy * s;
        x[b + 2] += dz * s;
      }

      /* Self contact: push apart to the contact distance, then take some of the sliding out. */
      for (let k = 0; k < pairs; k += 1) {
        const a = pairA[k] * 3;
        const b = pairB[k] * 3;
        const dx = x[a] - x[b];
        const dy = x[a + 1] - x[b + 1];
        const dz = x[a + 2] - x[b + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= contact * contact || d2 < 1e-18) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const nz = dz / d;
        const push = 0.5 * (contact - d);
        x[a] += nx * push;
        x[a + 1] += ny * push;
        x[a + 2] += nz * push;
        x[b] -= nx * push;
        x[b + 1] -= ny * push;
        x[b + 2] -= nz * push;
        const rx = x[a] - prev[a] - (x[b] - prev[b]);
        const ry = x[a + 1] - prev[a + 1] - (x[b + 1] - prev[b + 1]);
        const rz = x[a + 2] - prev[a + 2] - (x[b + 2] - prev[b + 2]);
        const rn = rx * nx + ry * ny + rz * nz;
        const f = 0.5 * CONTACT_FRICTION;
        const tx = (rx - rn * nx) * f;
        const ty = (ry - rn * ny) * f;
        const tz = (rz - rn * nz) * f;
        x[a] -= tx;
        x[a + 1] -= ty;
        x[a + 2] -= tz;
        x[b] += tx;
        x[b + 1] += ty;
        x[b + 2] += tz;
      }

      /* The hands: project particles outside the ellipsoid back in, with wall friction. */
      for (let p = 0; p < count; p += 1) {
        const o = p * 3;
        const wx = x[o];
        const wy = x[o + 1];
        const wz = x[o + 2];
        const lx = frame[0] * wx + frame[3] * wy + frame[6] * wz;
        const ly = frame[1] * wx + frame[4] * wy + frame[7] * wz;
        const lz = frame[2] * wx + frame[5] * wy + frame[8] * wz;
        const k = Math.sqrt((lx / ea) ** 2 + (ly / eb) ** 2 + (lz / ec) ** 2);
        if (k <= 1) continue;
        const qx = lx / k;
        const qy = ly / k;
        const qz = lz / k;
        let gx = qx / (ea * ea);
        let gy = qy / (eb * eb);
        let gz = qz / (ec * ec);
        const gl = Math.hypot(gx, gy, gz) || 1;
        gx /= gl;
        gy /= gl;
        gz /= gl;
        const px = frame[0] * qx + frame[1] * qy + frame[2] * qz;
        const py = frame[3] * qx + frame[4] * qy + frame[5] * qz;
        const pz = frame[6] * qx + frame[7] * qy + frame[8] * qz;
        const nx = frame[0] * gx + frame[1] * gy + frame[2] * gz;
        const ny = frame[3] * gx + frame[4] * gy + frame[5] * gz;
        const nz = frame[6] * gx + frame[7] * gy + frame[8] * gz;
        const mx = px - prev[o];
        const my = py - prev[o + 1];
        const mz = pz - prev[o + 2];
        const mn = mx * nx + my * ny + mz * nz;
        x[o] = px - (mx - mn * nx) * WALL_FRICTION;
        x[o + 1] = py - (my - mn * ny) * WALL_FRICTION;
        x[o + 2] = pz - (mz - mn * nz) * WALL_FRICTION;
      }
      /* Stretch again after the hands (measured in Node over the 36 shapes and folds of a 3:4 sheet: the ball's mean stretch error along rows falls from 1.8 to 3.0% with one sweep to 1.2 to 2.3% with three, for about 15% more solve time). */
      for (let sweep = 0; sweep < STRETCH_AFTER_HANDS; sweep += 1) stretch();
      yield (step * SUBSTEPS + sub + 1) / (totalSteps * SUBSTEPS);
    }

    /* Keep the sheet centered in the hands. */
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let p = 0; p < count; p += 1) {
      cx += x[p * 3];
      cy += x[p * 3 + 1];
      cz += x[p * 3 + 2];
    }
    cx /= count;
    cy /= count;
    cz /= count;
    for (let p = 0; p < count; p += 1) {
      x[p * 3] -= cx;
      x[p * 3 + 1] -= cy;
      x[p * 3 + 2] -= cz;
      prev[p * 3] -= cx;
      prev[p * 3 + 1] -= cy;
      prev[p * 3 + 2] -= cz;
    }

    if ((step + 1) % CAPTURE_EVERY === 0) {
      frames.push(Float32Array.from(x));
      buried.push(measureBurial());
    }
  }

  if (process.env.NODE_ENV !== "production") {
    let error = 0;
    for (let k = 0; k < sA.length; k += 1) error += Math.abs(Math.hypot(x[sA[k] * 3] - x[sB[k] * 3], x[sA[k] * 3 + 1] - x[sB[k] * 3 + 1], x[sA[k] * 3 + 2] - x[sB[k] * 3 + 2]) / sRest[k] - 1);
    let spread = 0;
    for (let p = 0; p < count; p += 1) spread += x[p * 3] ** 2 + x[p * 3 + 1] ** 2 + x[p * 3 + 2] ** 2;
    const rms = Math.sqrt(spread / count);
    /* Development checks of the solver's invariants, as warnings rather than console.assert, whose console error the framework's overlay would raise as a page error. */
    const check = (holds: boolean, message: string) => {
      if (!holds) console.warn(`CrumpledPaperReveal: ${message}`);
    };
    check(x.every(Number.isFinite), "the crumple produced a non-finite position");
    check(error / sA.length < 0.02, `mean stretch error ${((error / sA.length) * 100).toFixed(2)}% is over 2%`);
    const expected = 0.8 * endRadius * Math.cbrt(CONTAINER_AXES[0] * CONTAINER_AXES[1] * CONTAINER_AXES[2]);
    check(Math.abs(rms / expected - 1) < 0.2, `ball RMS radius ${rms.toFixed(3)} is not within 20% of ${expected.toFixed(3)}`);
  }

  return { cols, rows, width, height, frames, buried, radius: endRadius, contact };
}
