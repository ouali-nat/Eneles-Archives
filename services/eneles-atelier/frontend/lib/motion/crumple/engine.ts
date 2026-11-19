import {
  BufferAttribute,
  BufferGeometry,
  DepthTexture,
  DoubleSide,
  DynamicDrawUsage,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
  type IUniform,
} from "three";
import { springs, type SpringState } from "@/lib/motion/spring";
import { scrollParent } from "@/lib/motion/dom";
import { creaseSpec, creaseUniforms, FACET_LAYERS, type Fold } from "@/lib/motion/crumple/creases";
import { InkLayer, measureFace, PrintLayer, type FaceLayout } from "@/lib/motion/crumple/face";
import { between, random, streamSeed } from "@/lib/motion/crumple/hash";
import { advanceSpring, scrollOpenness, smoothstep, squeezeVelocity, startTween, tweenAt, type Scrub, type Tween } from "@/lib/motion/crumple/progress";
import { creaseFragment, depthFragment, groundFragment, groundVertex, passVertex, sheetFragment, sheetVertex } from "@/lib/motion/crumple/shaders";
import { crumpleJob, gridFor, type CrumpleRecording } from "@/lib/motion/crumple/simulation";
import { readCrumpleTokens, type CrumpleTokens } from "@/lib/motion/crumple/tokens";
import { buildTrack, computeNormals, flatGrid, gridIndex, limitStrain, multiply, rotateVector, sampleTrack, slerpFromIdentity, upsampleGrid, yaw, type CrumpleTrack, type Quaternion } from "@/lib/motion/crumple/track";

/* The crumple engine: one three.js WebGLRenderer on a detached canvas serves every sheet on the page (three's "multiple elements" pattern). A sheet's frame renders into the top-left corner of the shared canvas and is copied into the sheet's own 2D canvas in the same task, so each sheet keeps its last picture at no cost while nothing moves, while it is offscreen, and through a lost context. One animation-frame loop drives every sheet and the solver jobs, renders a sheet only when it is near view, the tab is visible, and something changed, and stops when nothing is left to do. The renderer is released three seconds after the last sheet detaches.

Per frame, everything follows from the openness o (0 a ball, 1 flat): the track's shape at tau = 1 - o, its orientation, scale, and grounding on the page, the relief of the flat sheet, the crease strength, and the self shadow. The engine writes the sheet's phase to the root as data-state (closed, opening, open, closing), plus data-live, data-busy, data-fallback, and --crumple-bleed; React never renders those. */

export type SheetMotion = "full" | "reduced" | "off";
export type SheetPaper = "ivory" | "page" | "kraft";
export type SheetRuling = "none" | "lines" | "grid" | "dots";
export type SheetFinish = "matte" | "satin" | "gloss";

export type SheetOptions = {
  motion: SheetMotion;
  paper: SheetPaper;
  ruling: SheetRuling;
  fold: Fold;
  creases: number;
  finish: SheetFinish;
  light: number;
  ballSize: number;
  shape: number;
  shadow: boolean;
  face: "paint" | "overlay";
  image: { src: string; focus: readonly [number, number] } | null;
};

export type SheetCallbacks = {
  /* The sheet came to rest open (true) or crumpled (false) after a change; never on attach. */
  onSettle: (open: boolean) => void;
  /* WebGL is unavailable or was lost for good: the component takes over with the CSS still sheet. */
  onFallback: () => void;
};

export type SheetHandle = {
  setOptions: (options: SheetOptions) => void;
  /* Animate toward open or closed; `instant` jumps there (the in-view replay reset). */
  setTarget: (open: boolean, instant?: boolean) => void;
  /* Follow a host's openness each frame (0 to 1), or null to go back to the target. */
  setProgress: (progress: number | null) => void;
  /* Follow the sheet's position in its scroller, or null to stop. */
  setScroll: (scrub: Scrub | null) => void;
  /* Hover and press on a closed click sheet: the ball lifts and presses. */
  setAffordance: (hover: boolean, press: boolean) => void;
  invalidateInk: () => void;
  dispose: () => void;
};

/* Rendering. */
const PIXEL_RATIO_CAP = 2;
const SHARED_PIXELS_CAP = 4.2e6;
const CAMERA_DISTANCE = 2.4;
const BLEED_SHARE = 0.22;
const BLEED_PIXELS = 16;
const KEY_SHADOW_SIZE = 1024;
const KEY_SHADOW_SMALL = 512;
const AMBIENT_SIZE = 512;

/* Light. The key rakes at this elevation from --light-angle, the rim answers from the opposite side; the cursor lamp hangs this far above the page (a share of the long side), falls off over its reach, and dims the key while it is on; the ambient sky and page bounce carry these weights. */
const KEY_ELEVATION = (26 * Math.PI) / 180;
const RIM_ELEVATION = (18 * Math.PI) / 180;
const RIM_SHARE = 0.35;
const LAMP_HEIGHT = 0.32;
const LAMP_REACH = 1.2;
const LAMP_GAIN = 1.1;
const LAMP_NEAR = 160;
const LAMP_KEY_DIM = 0.4;
const SKY_WEIGHT = 0.35;
const BOUNCE_WEIGHT = 0.3;
/* The page's key shadow fades over this share of the long side away from what casts it. */
const SHADOW_FADE = 0.45;

/* Shape. The ball's outer radius as a share of the long side (about 45% across), the grounding gap, the hover lift, and the closing squeeze's depth. */
const BALL_RADIUS = 0.225;
const GROUND_GAP = 0.6;
const LIFT_PIXELS = 6;
const LIFT_SCALE = 0.03;
const PRESS_SCALE = -0.03;
const SQUEEZE = -0.03;
const SETTLE_FROM = 1.6;
/* How much of each triangle's own flat normal the crumpled sheet shows: enough to read as faceted paper, not so much that the mesh's triangles show. */
const FACET_SHARE = 0.35;

/* Scheduling and caches. */
const SOLVER_BUDGET_BUSY = 4;
const SOLVER_BUDGET_IDLE = 10;
const TRACK_CACHE = 8;
const CREASE_CACHE = 4;
const RELEASE_DELAY = 3000;
const LOST_DELAY = 3000;
const REPAINT_DELAY = 120;
const NEAR_MARGIN = "200px";

const papers: Record<SheetPaper, { translucency: number; grain: number }> = {
  ivory: { translucency: 0.14, grain: 1 },
  page: { translucency: 0.08, grain: 1 },
  kraft: { translucency: 0.06, grain: 2 },
};
const finishes: Record<SheetFinish, [number, number, number]> = {
  matte: [0.9, 0.028, 0.18],
  satin: [0.5, 0.036, 0.55],
  gloss: [0.2, 0.045, 1],
};

/* A small least-recently-used map, for values a holder keeps its own reference to (an evicted track stays with the sheets showing it). */
class Lru<V> {
  private map = new Map<string, V>();
  constructor(private limit: number) {}
  get(key: string) {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string);
  }
}

/* Shared state. */
let renderer: WebGLRenderer | null = null;
let rendererFailed = false;
let contextLost = false;
let lostTimer = 0;
let releaseTimer = 0;
let halfFloat = false;
let sharedWidth = 1;
let sharedHeight = 1;
let keyTarget: WebGLRenderTarget | null = null;
let keyTargetSmall: WebGLRenderTarget | null = null;
let ambientTarget: WebGLRenderTarget | null = null;
let passScene: Scene | null = null;
let passMesh: Mesh | null = null;
let passMaterial: RawShaderMaterial | null = null;
const passCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const sheets = new Set<Sheet>();
const tracks = new Lru<CrumpleTrack>(TRACK_CACHE);
/* Crease maps by key, shared by the sheets that draw them: a map lives while any sheet holds it, and up to CREASE_CACHE maps nobody holds are kept for reuse. */
const creaseMaps = new Map<string, { target: WebGLRenderTarget; users: number }>();
type Job = { key: string; shape: number; generator: Generator<number, CrumpleRecording, void>; waiting: Set<Sheet> };
const jobs = new Map<string, Job>();
let loop = 0;
let lastTick = 0;
const pointer = { x: 0, y: 0, fine: false, present: false, stamp: 0 };
let listening = false;
let themeObserver: MutationObserver | null = null;

function wake() {
  if (!loop && typeof document !== "undefined" && !document.hidden) loop = requestAnimationFrame(tick);
}

function onPointerMove(event: PointerEvent) {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.fine = event.pointerType === "mouse" || event.pointerType === "pen";
  pointer.present = true;
  pointer.stamp += 1;
  wake();
}
function onPointerOut(event: PointerEvent) {
  if (event.relatedTarget) return;
  pointer.present = false;
  pointer.stamp += 1;
  wake();
}
function onScroll() {
  pointer.stamp += 1;
  for (const sheet of sheets) sheet.scrolled = true;
  wake();
}
function onVisibility() {
  if (!document.hidden) {
    lastTick = 0;
    wake();
  }
}

function listen(on: boolean) {
  if (on === listening) return;
  listening = on;
  if (on) {
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    /* The theme flips attributes on html, and the light angle and rim live in its inline style. */
    themeObserver = new MutationObserver(() => {
      for (const sheet of sheets) sheet.themeChanged();
      wake();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-mode", "style", "data-motion"] });
  } else {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("visibilitychange", onVisibility);
    themeObserver?.disconnect();
    themeObserver = null;
  }
}

function fallbackAll() {
  rendererFailed = true;
  for (const sheet of sheets) sheet.fail();
}

function ensureRenderer(): WebGLRenderer | null {
  if (renderer || rendererFailed) return renderer;
  try {
    const canvas = document.createElement("canvas");
    const made = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "default", preserveDrawingBuffer: false });
    made.setPixelRatio(1);
    made.autoClear = false;
    made.setClearColor(0x000000, 0);
    halfFloat = made.extensions.has("EXT_color_buffer_float") || made.extensions.has("EXT_color_buffer_half_float");
    /* Only the live renderer's context counts: releasing a renderer forces its context lost, and that event arrives after the release. */
    canvas.addEventListener("webglcontextlost", (event) => {
      if (renderer !== made) return;
      event.preventDefault();
      contextLost = true;
      window.clearTimeout(lostTimer);
      lostTimer = window.setTimeout(() => {
        if (contextLost && renderer === made) fallbackAll();
      }, LOST_DELAY);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      if (renderer !== made) return;
      contextLost = false;
      window.clearTimeout(lostTimer);
      /* Render targets lost their pictures; geometry and textures upload again on their own. */
      clearCreaseMaps();
      for (const sheet of sheets) sheet.contextRestored();
      wake();
    });
    renderer = made;
    sharedWidth = sharedHeight = 1;
    return made;
  } catch (error) {
    console.warn("CrumpledPaperReveal: WebGL2 is unavailable, showing the still sheet.", error);
    rendererFailed = true;
    return null;
  }
}

function releaseRenderer() {
  if (sheets.size || !renderer) return;
  const old = renderer;
  renderer = null;
  contextLost = false;
  window.clearTimeout(lostTimer);
  clearCreaseMaps();
  keyTarget?.dispose();
  keyTargetSmall?.dispose();
  ambientTarget?.dispose();
  keyTarget = keyTargetSmall = ambientTarget = null;
  passMaterial?.dispose();
  passMesh?.geometry.dispose();
  passScene = null;
  passMesh = null;
  passMaterial = null;
  old.forceContextLoss();
  old.dispose();
}

function depthTarget(size: number) {
  return new WebGLRenderTarget(size, size, { depthBuffer: true, depthTexture: new DepthTexture(size, size, UnsignedIntType), minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false });
}

const creaseKeyOf = (shape: number, fold: Fold, width: number, height: number, bucket: number) => `${shape}:${fold}:${(width / height).toFixed(3)}:${bucket}`;

function releaseCreaseMap(key: string) {
  const entry = creaseMaps.get(key);
  if (!entry) return;
  entry.users = Math.max(0, entry.users - 1);
  let unheld = 0;
  for (const candidate of creaseMaps.values()) if (!candidate.users) unheld += 1;
  for (const [candidateKey, candidate] of creaseMaps) {
    if (unheld <= CREASE_CACHE) break;
    if (candidate.users) continue;
    candidate.target.dispose();
    creaseMaps.delete(candidateKey);
    unheld -= 1;
  }
}

function clearCreaseMaps() {
  for (const entry of creaseMaps.values()) entry.target.dispose();
  creaseMaps.clear();
}

/* Holds the crease map for a shape, fold, aspect, and size bucket, rendering it once in one GPU pass; the holder gives it back with releaseCreaseMap. */
function holdCreaseMap(gl: WebGLRenderer, key: string, shape: number, fold: Fold, width: number, height: number, bucket: number, sizePx: [number, number]): WebGLRenderTarget {
  const cached = creaseMaps.get(key);
  if (cached) {
    cached.users += 1;
    creaseMaps.delete(key);
    creaseMaps.set(key, cached);
    return cached.target;
  }
  const longPx = Math.max(sizePx[0], sizePx[1]);
  const w = Math.max(1, Math.round((bucket * width) / Math.max(width, height)));
  const h = Math.max(1, Math.round((bucket * height) / Math.max(width, height)));
  const target = new WebGLRenderTarget(w, h, {
    type: halfFloat ? HalfFloatType : UnsignedByteType,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    anisotropy: Math.min(8, gl.capabilities.getMaxAnisotropy()),
  });
  if (!passScene || !passMesh || !passMaterial) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    passMaterial = new RawShaderMaterial({ vertexShader: passVertex, fragmentShader: creaseFragment, glslVersion: GLSL3, depthTest: false, depthWrite: false, blending: NoBlending, uniforms: creaseUniformSet() });
    passMesh = new Mesh(geometry, passMaterial);
    passMesh.frustumCulled = false;
    passScene = new Scene();
    passScene.add(passMesh);
  }
  const spec = creaseSpec(shape, fold, width, height);
  const lines = creaseUniforms(spec);
  const fine = Math.max(0.6, 0.0016 * longPx);
  const u = passMaterial.uniforms;
  (u.uSize.value as Vector2).set(sizePx[0], sizePx[1]);
  (u.uMaterial.value as Vector2).set(width, height);
  u.uSeed.value = spec.seed;
  FACET_LAYERS.forEach((layer, index) => {
    const cellPx = longPx / layer.cells;
    (u.uLayers.value as Vector4[])[index].set(cellPx, layer.slope, index < 2 ? fine * 2 : fine, cellPx >= 6 ? 1 : 0);
  });
  u.uLineCount.value = lines.count;
  lines.a.forEach((line, index) => (u.uLineA.value as Vector4[])[index].fromArray(line));
  lines.b.forEach((line, index) => (u.uLineB.value as Vector4[])[index].fromArray(line));
  u.uCoarseWidth.value = fine * 2;
  gl.setRenderTarget(target);
  gl.setScissorTest(false);
  gl.state.buffers.color.setMask(true);
  gl.clear(true, false, false);
  gl.render(passScene, passCamera);
  gl.setRenderTarget(null);
  creaseMaps.set(key, { target, users: 1 });
  return target;
}

function creaseUniformSet(): Record<string, IUniform> {
  return {
    uSize: { value: new Vector2(1, 1) },
    uMaterial: { value: new Vector2(1, 1) },
    uSeed: { value: 1 },
    uLayers: { value: [0, 1, 2, 3].map(() => new Vector4()) },
    uLineCount: { value: 0 },
    uLineA: { value: Array.from({ length: 8 }, () => new Vector4()) },
    uLineB: { value: Array.from({ length: 8 }, () => new Vector4()) },
    uCoarseWidth: { value: 1.2 },
  };
}

const trackKey = (shape: number, fold: Fold, cols: number, rows: number) => `${shape}:${fold}:${cols}x${rows}`;

/* Stops a sheet waiting on solver jobs other than `keep`; a job nobody waits on any more is dropped, so sliding through shapes never queues every crumple on the way. */
function leaveJobs(sheet: Sheet, keep: string | null) {
  for (const [key, job] of jobs) {
    if (key === keep) continue;
    job.waiting.delete(sheet);
    if (!job.waiting.size) jobs.delete(key);
  }
}

/* Starts (or joins) the solver job for a track. */
function requestTrack(sheet: Sheet, shape: number, fold: Fold, grid: { cols: number; rows: number; width: number; height: number }) {
  const key = trackKey(shape, fold, grid.cols, grid.rows);
  leaveJobs(sheet, key);
  const ready = tracks.get(key);
  if (ready) return ready;
  let job = jobs.get(key);
  if (!job) {
    job = { key, shape, generator: crumpleJob(shape, fold, grid.cols, grid.rows, grid.width, grid.height), waiting: new Set() };
    jobs.set(key, job);
  }
  job.waiting.add(sheet);
  wake();
  return null;
}

/* Runs solver jobs for at most `budget` milliseconds, most urgent first: a job a near, closed sheet is waiting on comes before one for a sheet that starts open. */
function runJobs(budget: number) {
  const start = performance.now();
  while (jobs.size && performance.now() - start < budget) {
    let best: Job | null = null;
    let bestScore = -1;
    for (const job of jobs.values()) {
      let score = 0;
      for (const sheet of job.waiting) score = Math.max(score, sheet.urgency());
      if (score > bestScore) {
        bestScore = score;
        best = job;
      }
    }
    if (!best) return;
    if (bestScore === 0) {
      jobs.delete(best.key);
      continue;
    }
    for (;;) {
      const step = best.generator.next();
      if (step.done) {
        const track = buildTrack(step.value, best.shape);
        tracks.set(best.key, track);
        jobs.delete(best.key);
        for (const sheet of best.waiting) sheet.trackReady(best.key, track);
        break;
      }
      if (performance.now() - start >= budget) return;
    }
  }
}

function tick(now: number) {
  loop = 0;
  if (document.hidden) {
    lastTick = 0;
    return;
  }
  const seconds = lastTick ? Math.min(1 / 15, (now - lastTick) / 1000) : 1 / 60;
  lastTick = now;
  let busy = false;
  for (const sheet of sheets) if (sheet.update(now, seconds)) busy = true;
  if (jobs.size) runJobs(busy ? SOLVER_BUDGET_BUSY : SOLVER_BUDGET_IDLE);
  for (const sheet of sheets) sheet.renderIfNeeded();
  if (busy || jobs.size || [...sheets].some((sheet) => sheet.waiting())) loop = requestAnimationFrame(tick);
  else lastTick = 0;
}

type Phase = "closed" | "opening" | "open" | "closing";

class Sheet {
  scrolled = true;
  private options: SheetOptions;
  private context2d: CanvasRenderingContext2D | null;
  private tokens: CrumpleTokens;
  private layout: FaceLayout = { print: null, firstLine: 0, line: 28, rtl: false, blend: 0, printSize: [0, 0] };
  private width = 0;
  private height = 0;
  private bleed = 0;
  private pw = 0;
  private ph = 0;
  private near = true;
  private failed = false;
  private disposed = false;
  private live = false;

  /* Openness and its drivers. */
  private target: boolean;
  private o: number;
  private tween: Tween | null = null;
  private progress: number | null = null;
  private scrub: Scrub | null = null;
  private scrubState: SpringState = { value: 0, velocity: 0 };
  private phase: Phase;
  private pendingPhase: Phase | null = null;
  private lastSettled: boolean | null;
  private ink = 1;
  private inkTween: Tween | null = null;
  private settle: SpringState = { value: SETTLE_FROM, velocity: 0 };
  private squeeze: SpringState = { value: 0, velocity: 0 };
  private lift: SpringState = { value: 0, velocity: 0 };
  private liftTarget = 0;
  private lampShare: SpringState = { value: 0, velocity: 0 };
  private lampX: SpringState = { value: 0, velocity: 0 };
  private lampY: SpringState = { value: 0, velocity: 0 };
  private lampStamp = -1;

  /* Geometry. */
  private grid = { cols: 2, rows: 2, width: 1, height: 1 };
  private renderCols = 3;
  private renderRows = 3;
  private track: CrumpleTrack | null = null;
  private trackId = "";
  private flat: Float32Array = new Float32Array(0);
  private simPositions = new Float32Array(0);
  private simAo = new Float32Array(0);
  private scratch3 = new Float32Array(0);
  private scratch1 = new Float32Array(0);
  private renderPositions = new Float32Array(0);
  private renderAo = new Float32Array(0);
  private index: Uint32Array = new Uint32Array(0);
  private geometry: BufferGeometry | null = null;
  private bounds = { center: new Vector3(), radius: 1, minX: 0, maxX: 0, minY: 0, maxY: 0, maxZ: 0 };
  private poseDirty = true;
  private frameDirty = true;

  /* GPU resources. */
  private scene: Scene | null = null;
  private camera = new PerspectiveCamera(30, 1, 1, 10);
  private keyCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private ambientCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private mesh: Mesh | null = null;
  private ground: Mesh | null = null;
  private material: RawShaderMaterial | null = null;
  private depthMaterial: RawShaderMaterial | null = null;
  private groundMaterial: RawShaderMaterial | null = null;
  private uniforms: Record<string, IUniform> = {};
  private groundUniforms: Record<string, IUniform> = {};
  private inkLayer: InkLayer | null = null;
  private printLayer: PrintLayer | null = null;
  private creaseKey = "";
  private bucket = 512;

  /* Observers and timers. */
  private resize: ResizeObserver;
  private visibility: IntersectionObserver;
  private mutations: MutationObserver;
  private repaintTimer = 0;
  private scroller: HTMLElement | null;
  private seedNext: () => number;
  private corners = new Vector4();
  private fiberAngle = 0;
  /* The still sheet's corner radius in pixels, read from CSS when the size, theme, or options change rather than every frame. */
  private cornerRadius = 2;
  private keyDir = new Vector3();
  private rimDir = new Vector3();
  private lampDir = new Vector3();
  private lightDir = new Vector3();

  constructor(
    private root: HTMLElement,
    private canvas: HTMLCanvasElement,
    private face: HTMLElement,
    options: SheetOptions,
    open: boolean,
    private callbacks: SheetCallbacks,
  ) {
    this.options = options;
    this.context2d = canvas.getContext("2d");
    this.tokens = readCrumpleTokens(root);
    this.target = options.motion === "off" ? true : open;
    this.o = this.target ? 1 : 0;
    this.ink = this.target || options.motion !== "full" ? 0 : 1;
    this.phase = this.target ? "open" : "closed";
    this.lastSettled = this.target;
    this.settle.value = 1;
    this.scroller = scrollParent(root);
    this.seedNext = random(streamSeed(options.shape, 21));
    root.dataset.state = this.phase;
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(root);
    this.visibility = new IntersectionObserver(
      ([entry]) => {
        this.near = entry.isIntersecting;
        if (this.near) wake();
      },
      { rootMargin: NEAR_MARGIN },
    );
    this.visibility.observe(root);
    this.mutations = new MutationObserver(() => this.scheduleRepaint());
    this.mutations.observe(face, { subtree: true, childList: true, characterData: true, attributes: true });
    face.addEventListener("load", this.onLoad, true);
    document.fonts?.addEventListener?.("loadingdone", this.onLoad);
    this.reseed();
    this.measure();
    void document.fonts?.ready.then(() => {
      if (!this.disposed) this.scheduleRepaint(0);
    });
  }

  private onLoad = () => this.scheduleRepaint();

  /* Seeded per-shape details: corner lifts and the paper's machine direction. */
  private reseed() {
    this.seedNext = random(streamSeed(this.options.shape, 21));
    const next = this.seedNext;
    this.corners.set(between(next, 0, 6), between(next, 0, 6), between(next, 0, 6), between(next, 0, 6));
    this.fiberAngle = (this.height > this.width ? Math.PI / 2 : 0) + between(next, -0.17, 0.17);
  }

  /* How badly the sheet needs its track now: a closed or closing sheet near view first. */
  urgency() {
    if (this.disposed || this.failed || this.options.motion !== "full") return 0;
    const wantsBall = !this.target || this.progress !== null || this.scrub !== null;
    return (wantsBall ? 2 : 1) + (this.near ? 2 : 0);
  }

  waiting() {
    return !this.disposed && !this.failed && this.near && this.frameDirty && this.width > 0;
  }

  setOptions(next: SheetOptions) {
    const previous = this.options;
    this.options = next;
    if (next.motion !== previous.motion) {
      if (next.motion === "off") this.jump(true);
      else if (next.motion === "reduced") {
        this.ink = 0;
        this.settle.value = 1;
        this.squeeze = { value: 0, velocity: 0 };
        this.lift = { value: 0, velocity: 0 };
        this.jump(this.target);
      } else this.jump(this.target);
    }
    if (next.shape !== previous.shape || next.fold !== previous.fold) this.reseed();
    this.resolveTrack();
    if (next.image?.src !== previous.image?.src || next.image?.focus[0] !== previous.image?.focus[0] || next.image?.focus[1] !== previous.image?.focus[1]) this.scheduleRepaint(0);
    if (next.face !== previous.face) this.scheduleRepaint(0);
    this.tokens = readCrumpleTokens(this.root);
    this.readCorner();
    this.poseDirty = true;
    this.frameDirty = true;
    this.scheduleRepaint();
    wake();
  }

  setTarget(open: boolean, instant = false) {
    const next = this.options.motion === "off" ? true : open;
    if (instant) {
      this.target = next;
      this.jump(next);
      return;
    }
    if (next === this.target) return;
    this.target = next;
    if (this.progress !== null || this.scrub !== null) return;
    this.begin();
  }

  setProgress(progress: number | null) {
    this.progress = progress === null ? null : Math.min(1, Math.max(0, progress));
    if (this.progress === null) this.begin();
    this.frameDirty = true;
    wake();
  }

  setScroll(scrub: Scrub | null) {
    this.scrub = scrub;
    this.scrolled = true;
    this.scrubState = { value: this.o, velocity: 0 };
    if (scrub === null) this.begin();
    if (scrub !== null && this.options.motion === "full") this.resolveTrack();
    wake();
  }

  setAffordance(hover: boolean, press: boolean) {
    const next = press ? -1 : hover ? 1 : 0;
    if (next === this.liftTarget) return;
    this.liftTarget = next;
    wake();
  }

  invalidateInk() {
    this.scheduleRepaint(0);
  }

  themeChanged() {
    this.tokens = readCrumpleTokens(this.root);
    this.readCorner();
    this.frameDirty = true;
    this.scheduleRepaint();
  }

  private readCorner() {
    const still = this.root.querySelector<HTMLElement>(".crumple-still");
    this.cornerRadius = still ? Number.parseFloat(getComputedStyle(still).borderTopLeftRadius) || 2 : 2;
  }

  contextRestored() {
    this.creaseKey = "";
    this.inkLayer?.texture.dispose();
    this.printLayer?.texture.dispose();
    this.scheduleRepaint(0);
    this.poseDirty = true;
    this.frameDirty = true;
  }

  fail() {
    if (this.failed) return;
    this.failed = true;
    this.root.dataset.fallback = "";
    delete this.root.dataset.live;
    delete this.root.dataset.busy;
    this.callbacks.onFallback();
  }

  trackReady(key: string, track: CrumpleTrack) {
    if (key !== this.trackId || this.disposed) return;
    this.track = track;
    delete this.root.dataset.busy;
    this.poseDirty = true;
    this.frameDirty = true;
    /* A change asked for while the track was building starts now. */
    if (this.progress === null && this.scrub === null && (this.target ? 1 : 0) !== this.o) this.begin();
    wake();
  }

  /* Jump to a state without motion. */
  private jump(open: boolean) {
    this.tween = null;
    this.o = open ? 1 : 0;
    this.ink = open || this.options.motion !== "full" || this.options.face === "overlay" ? 0 : 1;
    this.inkTween = null;
    this.settle = { value: 1, velocity: 0 };
    this.squeeze = { value: 0, velocity: 0 };
    this.setPhase(open ? "open" : "closed");
    this.lastSettled = open;
    this.poseDirty = true;
    this.frameDirty = true;
    wake();
  }

  /* Start moving toward the target from wherever the sheet is. */
  private begin() {
    const motion = this.options.motion;
    if (motion === "off") return this.jump(true);
    const to = this.target ? 1 : 0;
    if (this.o === to && !this.tween) return;
    if (motion === "full" && !this.track) {
      /* Without a track there is no ball yet: an open request lands flat at once, a close waits for the track. */
      if (this.target) {
        this.jump(true);
        this.lastSettled = null;
        this.callbacks.onSettle(true);
      }
      return;
    }
    const now = performance.now();
    const duration = this.target ? this.tokens.openDuration : this.tokens.closeDuration;
    const ease = this.target ? this.tokens.openEase : this.tokens.closeEase;
    this.tween = startTween(this.o, to, now, duration, ease);
    if (this.target) {
      this.setPhase("opening");
      if (motion === "full") this.settle.value = SETTLE_FROM;
    } else if (this.phase === "open" && motion === "full" && this.options.face === "paint") {
      /* The painted ink comes back first and the face hides only after that frame is on screen, so the swap back is invisible. */
      this.ink = 1;
      this.inkTween = null;
      this.pendingPhase = "closing";
      this.frameDirty = true;
    } else this.setPhase("closing");
    wake();
  }

  private setPhase(phase: Phase) {
    this.pendingPhase = null;
    if (this.phase === phase) return;
    this.phase = phase;
    if (!this.failed) this.root.dataset.state = phase;
  }

  private measure() {
    if (this.disposed) return;
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (width < 2 || height < 2) {
      this.width = this.height = 0;
      return;
    }
    const sized = width !== this.width || height !== this.height;
    this.width = width;
    this.height = height;
    const longSide = Math.max(width, height);
    this.bleed = Math.round(BLEED_SHARE * longSide + BLEED_PIXELS);
    this.root.style.setProperty("--crumple-bleed", `${this.bleed}px`);
    let ratio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP);
    const cssW = width + 2 * this.bleed;
    const cssH = height + 2 * this.bleed;
    if (cssW * cssH * ratio * ratio > SHARED_PIXELS_CAP) ratio = Math.sqrt(SHARED_PIXELS_CAP / (cssW * cssH));
    const pw = Math.max(1, Math.round(cssW * ratio));
    const ph = Math.max(1, Math.round(cssH * ratio));
    let cleared = false;
    if (pw !== this.pw || ph !== this.ph) {
      this.pw = pw;
      this.ph = ph;
      this.canvas.width = pw;
      this.canvas.height = ph;
      cleared = true;
    }
    const devLong = longSide * ratio;
    const max = renderer?.capabilities.maxTextureSize ?? 4096;
    this.bucket = Math.min(max, devLong > 1400 ? 2048 : devLong > 600 ? 1024 : 512);
    const grid = gridFor(width / height);
    if (grid.cols !== this.grid.cols || grid.rows !== this.grid.rows) {
      this.grid = grid;
      this.allocateGrid();
      this.resolveTrack();
    } else this.grid = grid;
    if (sized) {
      this.reseed();
      this.readCorner();
      this.scheduleRepaint();
    }
    this.scrolled = true;
    this.poseDirty = true;
    this.frameDirty = true;
    /* Resizing cleared the canvas: draw again now, inside the resize callback and before the browser paints, so the sheet never blinks while its box is resized. */
    if (cleared && this.live) this.renderIfNeeded();
    wake();
  }

  private allocateGrid() {
    const { cols, rows, width, height } = this.grid;
    this.renderCols = 2 * cols - 1;
    this.renderRows = 2 * rows - 1;
    const vertices = this.renderCols * this.renderRows;
    this.flat = flatGrid(cols, rows, width, height);
    this.simPositions = new Float32Array(cols * rows * 3);
    this.simAo = new Float32Array(cols * rows);
    this.scratch3 = new Float32Array(this.renderCols * rows * 3);
    this.scratch1 = new Float32Array(this.renderCols * rows);
    this.renderPositions = new Float32Array(vertices * 3);
    this.renderAo = new Float32Array(vertices);
    this.index = gridIndex(this.renderCols, this.renderRows);
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
  }

  private resolveTrack() {
    if (this.options.motion !== "full") return;
    const key = trackKey(this.options.shape, this.options.fold, this.grid.cols, this.grid.rows);
    if (key === this.trackId && this.track) return;
    this.trackId = key;
    const ready = requestTrack(this, this.options.shape, this.options.fold, this.grid);
    if (ready) {
      this.track = ready;
      delete this.root.dataset.busy;
    } else {
      /* Keep the old ball on screen while the new one is solved, unless the grid changed. */
      if (this.track && (this.track.cols !== this.grid.cols || this.track.rows !== this.grid.rows)) this.track = null;
      this.root.dataset.busy = "";
    }
    this.poseDirty = true;
    this.frameDirty = true;
  }

  private scheduleRepaint(delay = REPAINT_DELAY) {
    if (this.disposed) return;
    window.clearTimeout(this.repaintTimer);
    this.repaintTimer = window.setTimeout(() => this.repaint(), delay);
  }

  private repaint() {
    if (this.disposed || this.failed || this.width === 0) return;
    const gl = ensureRenderer();
    if (!gl) return;
    this.layout = measureFace(this.face, this.width, this.height);
    const scale = Math.min(PIXEL_RATIO_CAP, this.bucket / Math.max(this.width, this.height));
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    this.inkLayer ??= new InkLayer(anisotropy);
    this.printLayer ??= new PrintLayer(anisotropy);
    if (this.options.face === "paint" && this.options.motion === "full") this.inkLayer.paint(this.face, this.width, this.height, scale, () => this.touch());
    const image = this.options.image;
    this.printLayer.update(image?.src, image?.focus ?? [0.5, 0.5], this.layout.printSize, scale, () => this.touch());
    this.touch();
  }

  private touch() {
    this.frameDirty = true;
    wake();
  }

  /* Advances openness, the ink fade, and the springs; returns true while anything still moves. */
  update(now: number, seconds: number): boolean {
    if (this.disposed || this.failed || this.width === 0) return false;
    const { motion } = this.options;
    let moving = false;
    const before = this.o;

    if (motion === "off") {
      this.o = 1;
      if (this.phase !== "open") this.setPhase("open");
    } else if (this.progress !== null) {
      this.o = this.progress;
      this.followPhase();
    } else if (this.scrub !== null && motion === "full") {
      if (this.scrolled && this.near) {
        this.scrolled = false;
        const box = this.root.getBoundingClientRect();
        const view = this.scroller?.getBoundingClientRect();
        const top = view ? view.top : 0;
        const height = view ? view.height : document.documentElement.clientHeight;
        const position = height > 0 ? (box.top + box.height / 2 - top) / height : 0.5;
        this.scrubTarget = scrollOpenness(position, this.scrub);
      }
      if (advanceSpring(this.scrubState, this.scrubTarget, springs.smooth, seconds, 1e-4)) moving = true;
      this.o = Math.min(1, Math.max(0, this.scrubState.value));
      this.followPhase();
    } else if (this.tween && this.pendingPhase) {
      /* A close waits for the frame that swaps the live content back to painted ink. */
      moving = true;
    } else if (this.tween) {
      const { value, done } = tweenAt(this.tween, now);
      this.o = value;
      if (done) {
        this.tween = null;
        this.arrive(this.target);
      } else moving = true;
    }

    /* The painted ink fades out as the live DOM fades in. */
    if (this.inkTween) {
      const { value, done } = tweenAt(this.inkTween, now);
      this.ink = value;
      if (done) this.inkTween = null;
      else moving = true;
      this.frameDirty = true;
    }

    /* The squeeze and the hover lift change the pose on the CPU; the landing settle and the lamp are uniforms and only need a frame. */
    let reshaped = false;
    if (motion === "full") {
      if (this.phase === "open" && advanceSpring(this.settle, 1, springs.bouncy, seconds, 1e-3)) moving = true;
      if (advanceSpring(this.squeeze, 0, springs.snappy, seconds, 1e-4)) reshaped = true;
      const liftGoal = this.phase === "closed" ? this.liftTarget : 0;
      if (advanceSpring(this.lift, liftGoal, springs.smooth, seconds, 1e-3)) reshaped = true;
      if (this.updateLamp(seconds)) moving = true;
    } else if (this.lampShare.value !== 0) {
      this.lampShare = { value: 0, velocity: 0 };
      this.frameDirty = true;
    }

    if (this.o !== before || reshaped) this.poseDirty = true;
    if (this.o !== before || reshaped || moving) this.frameDirty = true;
    moving = moving || reshaped;
    if (this.pendingPhase) this.frameDirty = true;
    return moving || this.tween !== null;
  }

  private scrubTarget = 0;

  /* Phases while openness follows a host's number or the scroll position. */
  private followPhase() {
    const o = this.o;
    if (o >= 0.9999) {
      if (this.phase !== "open") {
        this.setPhase("open");
        this.settled(true);
      }
    } else if (o <= 0.0001) {
      if (this.phase !== "closed") {
        this.setPhase("closed");
        this.settled(false);
      }
    } else {
      const opening = this.phase === "closed" || this.phase === "opening";
      this.setPhase(opening ? "opening" : "closing");
      this.ink = this.options.motion === "full" && this.options.face === "paint" ? 1 : 0;
      this.inkTween = null;
    }
    if (this.phase === "open" && this.ink > 0 && !this.inkTween && this.options.motion === "full") this.inkTween = startTween(this.ink, 0, performance.now(), this.tokens.fadeDuration, (t) => t);
  }

  private settled(open: boolean) {
    if (this.lastSettled === open) return;
    this.lastSettled = open;
    this.callbacks.onSettle(open);
  }

  private arrive(open: boolean) {
    const full = this.options.motion === "full";
    if (open) {
      this.setPhase("open");
      if (full && this.options.face === "paint") this.inkTween = startTween(this.ink, 0, performance.now(), this.tokens.fadeDuration, (t) => t);
      else this.ink = 0;
      this.settle.velocity = 0;
    } else {
      this.setPhase("closed");
      if (full) this.squeeze = { value: 0, velocity: squeezeVelocity(springs.snappy, SQUEEZE) };
    }
    this.settled(open);
  }

  private updateLamp(seconds: number): boolean {
    const strength = this.options.light;
    let shareGoal = 0;
    if (strength > 0 && pointer.present && pointer.fine && this.near) {
      if (this.lampStamp !== pointer.stamp) {
        this.lampStamp = pointer.stamp;
        const box = this.root.getBoundingClientRect();
        const zoom = box.width > 0 ? box.width / this.width : 1;
        const wx = (pointer.x - (box.left + box.width / 2)) / zoom;
        const wy = -(pointer.y - (box.top + box.height / 2)) / zoom;
        this.lampGoal = [wx, wy];
        const dx = Math.max(0, Math.abs(wx) - this.width / 2);
        const dy = Math.max(0, Math.abs(wy) - this.height / 2);
        this.lampInside = Math.hypot(dx, dy) <= LAMP_NEAR;
      }
      shareGoal = this.lampInside ? 1 : 0;
    }
    let moving = advanceSpring(this.lampShare, shareGoal, springs.smooth, seconds, 1e-3);
    if (this.lampShare.value > 0 || shareGoal > 0) {
      if (advanceSpring(this.lampX, this.lampGoal[0], springs.smooth, seconds, 0.05)) moving = true;
      if (advanceSpring(this.lampY, this.lampGoal[1], springs.smooth, seconds, 0.05)) moving = true;
    } else {
      this.lampX.value = this.lampGoal[0];
      this.lampY.value = this.lampGoal[1];
    }
    if (moving) this.frameDirty = true;
    return moving;
  }

  private lampGoal: [number, number] = [0, 0];
  private lampInside = false;

  renderIfNeeded() {
    if (this.disposed || this.failed) return;
    /* A phase waiting on a frame flips at once when no frame can be drawn. */
    const drawable = this.frameDirty && this.near && this.width > 0 && !document.hidden && !contextLost;
    if (!drawable) {
      if (this.pendingPhase && (!this.near || document.hidden || contextLost)) this.setPhase(this.pendingPhase);
      return;
    }
    const gl = ensureRenderer();
    if (!gl) {
      this.fail();
      return;
    }
    /* A closed sheet under Full has nothing to show until its ball exists; the placeholder stands in, and the track's arrival asks for the frame again. */
    if (this.options.motion === "full" && !this.track && this.o < 1) {
      if (this.pendingPhase) this.setPhase(this.pendingPhase);
      this.frameDirty = false;
      if (this.live) {
        this.live = false;
        delete this.root.dataset.live;
      }
      return;
    }
    try {
      this.draw(gl);
    } catch (error) {
      console.warn("CrumpledPaperReveal: drawing failed, showing the still sheet.", error);
      this.fail();
      return;
    }
    this.frameDirty = false;
    if (!this.live) {
      this.live = true;
      this.root.dataset.live = "";
    }
    if (this.pendingPhase) {
      const phase = this.pendingPhase;
      this.setPhase(phase);
      if (phase === "closing" && this.tween) this.tween.start = performance.now();
    }
  }

  private ensureResources(gl: WebGLRenderer) {
    if (!this.scene) {
      this.scene = new Scene();
      this.uniforms = this.makeUniforms();
      this.material = new RawShaderMaterial({ vertexShader: sheetVertex, fragmentShader: sheetFragment, glslVersion: GLSL3, side: DoubleSide, blending: NoBlending, uniforms: this.uniforms, alphaToCoverage: true });
      this.depthMaterial = new RawShaderMaterial({ vertexShader: sheetVertex, fragmentShader: depthFragment, glslVersion: GLSL3, side: DoubleSide, blending: NoBlending, uniforms: this.uniforms, colorWrite: false });
      this.groundUniforms = {
        uShadowMap: this.uniforms.uShadowMap,
        uShadowMatrix: this.uniforms.uShadowMatrix,
        uShadowRange: this.uniforms.uShadowRange,
        uShadowColor: { value: new Vector4() },
        uAmbientMap: { value: null },
        uAmbientMatrix: { value: new Matrix4() },
        uAmbientRange: { value: new Vector3() },
        uAmbientReach: { value: 60 },
        uHalo: { value: 4 },
        uCanvasHalf: { value: new Vector2(1, 1) },
        uEdgeFade: { value: 1 },
        uShadowFade: { value: 100 },
      };
      this.groundMaterial = new RawShaderMaterial({ vertexShader: groundVertex, fragmentShader: groundFragment, glslVersion: GLSL3, depthTest: false, depthWrite: false, blending: NoBlending, uniforms: this.groundUniforms });
      this.ground = new Mesh(new PlaneGeometry(1, 1), this.groundMaterial);
      this.ground.frustumCulled = false;
      this.ground.renderOrder = 0;
      this.scene.add(this.ground);
    }
    if (!this.geometry) {
      const vertices = this.renderCols * this.renderRows;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(DynamicDrawUsage));
      geometry.setAttribute("normal", new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(DynamicDrawUsage));
      geometry.setAttribute("ao", new BufferAttribute(new Float32Array(vertices), 1).setUsage(DynamicDrawUsage));
      const uv = new Float32Array(vertices * 2);
      for (let j = 0; j < this.renderRows; j += 1)
        for (let i = 0; i < this.renderCols; i += 1) {
          uv[(j * this.renderCols + i) * 2] = i / (this.renderCols - 1);
          uv[(j * this.renderCols + i) * 2 + 1] = j / (this.renderRows - 1);
        }
      geometry.setAttribute("uv", new BufferAttribute(uv, 2));
      geometry.setIndex(new BufferAttribute(this.index, 1));
      this.geometry = geometry;
      if (this.mesh) this.mesh.geometry = geometry;
      else {
        this.mesh = new Mesh(geometry, this.material!);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        this.scene.add(this.mesh);
      }
      this.poseDirty = true;
    }
    const key = creaseKeyOf(this.options.shape, this.options.fold, this.grid.width, this.grid.height, this.bucket);
    if (key !== this.creaseKey) {
      /* The new map is held before the old one is given back, so a map both keys share is never thrown away in between. */
      const previous = this.creaseKey;
      this.uniforms.uCreaseMap.value = holdCreaseMap(gl, key, this.options.shape, this.options.fold, this.grid.width, this.grid.height, this.bucket, [this.width, this.height]).texture;
      this.creaseKey = key;
      if (previous) releaseCreaseMap(previous);
    }
    if (!this.inkLayer || !this.printLayer) this.repaint();
    keyTarget ??= depthTarget(KEY_SHADOW_SIZE);
    keyTargetSmall ??= depthTarget(KEY_SHADOW_SMALL);
    ambientTarget ??= depthTarget(AMBIENT_SIZE);
  }

  private makeUniforms(): Record<string, IUniform> {
    return {
      uSize: { value: new Vector2(1, 1) },
      uFoldRelief: { value: new Vector4() },
      uCornerLift: { value: new Vector4() },
      uWave: { value: new Vector3() },
      uSeed: { value: 1 },
      uRelief: { value: 0 },
      uRegister: { value: 0 },
      uCameraZ: { value: 1000 },
      uFacet: { value: 0 },
      uEye: { value: new Vector3() },
      uCreaseMap: { value: null },
      uCreaseScale: { value: 0.55 },
      uInk: { value: null },
      uInkAmount: { value: 0 },
      uInkBlend: { value: 0 },
      uPrint: { value: null },
      uPrintRect: { value: new Vector4(0, 0, 0, 0) },
      uPrintAmount: { value: 0 },
      uPaper: { value: new Vector3() },
      uBack: { value: new Vector3() },
      uRuleColor: { value: new Vector3() },
      uRuleStrong: { value: new Vector3() },
      uMarginColor: { value: new Vector3() },
      uDotColor: { value: new Vector3() },
      uRuling: { value: 0 },
      uRule: { value: new Vector4(28, 28, -1, 20) },
      uGrain: { value: 1 },
      uFiberAngle: { value: 0 },
      uTranslucency: { value: 0.1 },
      uFinish: { value: new Vector3() },
      uKeyDir: { value: new Vector3(0, 0, 1) },
      uKeyColor: { value: new Vector3() },
      uRimDir: { value: new Vector3(0, 0, 1) },
      uRimColor: { value: new Vector3() },
      uLampPos: { value: new Vector3() },
      uLampColor: { value: new Vector3() },
      uLampReach: { value: 600 },
      uSky: { value: new Vector3() },
      uBounce: { value: new Vector3() },
      uExposure: { value: new Vector3(1, 1, 1) },
      uSelfShadow: { value: 0 },
      uCorner: { value: 2 },
      uShadowMap: { value: null },
      uShadowMatrix: { value: new Matrix4() },
      uShadowRange: { value: new Vector3(1, 1, 0) },
    };
  }

  /* The track's shape at the current openness, posed on the page, written into the geometry. */
  private pose() {
    const { cols, rows, width, height } = this.grid;
    const o = this.o;
    const full = this.options.motion === "full";
    const track = full && this.track && this.track.cols === cols && this.track.rows === rows ? this.track : null;
    const tau = track ? 1 - o : 0;
    if (track && tau > 1e-4) {
      sampleTrack(track, tau, this.simPositions, this.simAo);
      limitStrain(track, this.simPositions);
    } else {
      this.simPositions.set(this.flat);
      this.simAo.fill(1);
    }
    upsampleGrid(this.simPositions, cols, rows, 3, smoothstep(0.15, 0.7, o), this.scratch3, this.renderPositions);
    upsampleGrid(this.simAo, cols, rows, 1, 0, this.scratch1, this.renderAo);
    const sx = this.width / width;
    const sy = this.height / height;
    const sz = (sx + sy) / 2;
    let q: Quaternion = [0, 0, 0, 1];
    let scale = 1;
    if (track) {
      q = multiply(yaw(track.spin * tau), slerpFromIdentity(track.ballRotation, smoothstep(0, 0.85, tau)));
      const ball = (BALL_RADIUS / track.ballRadius) * this.options.ballSize;
      scale = 1 + (ball - 1) * Math.pow(tau, 1.5);
    }
    const lift = this.lift.value;
    scale *= (1 + this.squeeze.value) * (1 + (lift >= 0 ? LIFT_SCALE : -PRESS_SCALE) * lift);
    const geometry = this.geometry!;
    const positions = geometry.getAttribute("position").array as Float32Array;
    const vertices = this.renderCols * this.renderRows;
    let minZ = Infinity;
    for (let v = 0; v < vertices; v += 1) {
      const p = v * 3;
      rotateVector(q, this.renderPositions[p] * sx, this.renderPositions[p + 1] * sy, this.renderPositions[p + 2] * sz, positions, p);
      positions[p] *= scale;
      positions[p + 1] *= scale;
      positions[p + 2] *= scale;
      if (positions[p + 2] < minZ) minZ = positions[p + 2];
    }
    const ground = GROUND_GAP * (1 - smoothstep(0.9, 1, o)) + LIFT_PIXELS * Math.max(0, lift);
    const shift = ground - minZ;
    const b = this.bounds;
    b.minX = b.minY = Infinity;
    b.maxX = b.maxY = b.maxZ = -Infinity;
    for (let v = 0; v < vertices; v += 1) {
      const p = v * 3;
      positions[p + 2] += shift;
      if (positions[p] < b.minX) b.minX = positions[p];
      if (positions[p] > b.maxX) b.maxX = positions[p];
      if (positions[p + 1] < b.minY) b.minY = positions[p + 1];
      if (positions[p + 1] > b.maxY) b.maxY = positions[p + 1];
      if (positions[p + 2] > b.maxZ) b.maxZ = positions[p + 2];
    }
    b.center.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxZ / 2);
    let radius = 0;
    for (let v = 0; v < vertices; v += 1) {
      const p = v * 3;
      const d = Math.hypot(positions[p] - b.center.x, positions[p + 1] - b.center.y, positions[p + 2] - b.center.z);
      if (d > radius) radius = d;
    }
    /* Room for the relief of the flat sheet. */
    b.radius = radius + 24;
    computeNormals(positions, this.index, geometry.getAttribute("normal").array as Float32Array);
    (geometry.getAttribute("ao").array as Float32Array).set(this.renderAo);
    geometry.getAttribute("position").needsUpdate = true;
    geometry.getAttribute("normal").needsUpdate = true;
    geometry.getAttribute("ao").needsUpdate = true;
    this.poseDirty = false;
  }

  private draw(gl: WebGLRenderer) {
    this.ensureResources(gl);
    if (this.poseDirty) this.pose();
    const { options, tokens, layout } = this;
    const full = options.motion === "full";
    const o = this.o;
    const u = this.uniforms;
    const longSide = Math.max(this.width, this.height);
    const cssW = this.width + 2 * this.bleed;
    const cssH = this.height + 2 * this.bleed;

    /* Camera straight down the z axis at a reader's distance; z = 0 maps exactly onto the CSS layout. */
    const distance = CAMERA_DISTANCE * longSide;
    this.camera.fov = (2 * Math.atan(cssH / 2 / distance) * 180) / Math.PI;
    this.camera.aspect = cssW / cssH;
    this.camera.near = distance / 4;
    this.camera.far = distance * 2;
    this.camera.position.set(0, 0, distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.ground!.scale.set(cssW * 1.05, cssH * 1.05, 1);
    this.ground!.updateMatrixWorld();

    /* Sheet, relief, and crease strength. */
    (u.uSize.value as Vector2).set(this.width, this.height);
    const creases = options.creases;
    const foldKind = options.fold === "half" ? 1 : options.fold === "thirds" ? 2 : 0;
    (u.uFoldRelief.value as Vector4).set(foldKind, Math.tan(((2.5 * creases * 1.5) * Math.PI) / 180), 3, 0);
    (u.uCornerLift.value as Vector4).copy(this.corners).multiplyScalar(creases);
    (u.uWave.value as Vector3).set(1.5 * creases, 2.5, (options.shape * 7.31) % 50);
    u.uSeed.value = streamSeed(options.shape, 31);
    const settle = full ? this.settle.value : 1;
    u.uRelief.value = (full ? smoothstep(0.82, 1, o) : 1) * settle;
    u.uRegister.value = full ? smoothstep(0.82, 1, o) : 1;
    u.uCameraZ.value = distance;
    u.uFacet.value = full ? FACET_SHARE * (1 - smoothstep(0.2, 0.9, o)) : 0;
    (u.uEye.value as Vector3).set(0, 0, distance);
    u.uCreaseScale.value = full ? Math.max(creases, 0.8) * 1.2 + (creases - Math.max(creases, 0.8) * 1.2) * smoothstep(0.5, 1, o) : creases;

    /* Content. */
    const ink = this.inkLayer;
    u.uInk.value = ink?.texture ?? null;
    u.uInkAmount.value = full && options.face === "paint" && ink ? this.ink : 0;
    u.uInkBlend.value = layout.blend;
    const print = this.printLayer;
    const printed = !!(options.image && print?.ready && layout.print);
    u.uPrint.value = print?.texture ?? null;
    (u.uPrintRect.value as Vector4).fromArray(printed ? layout.print! : [0, 0, 0, 0]);
    u.uPrintAmount.value = printed ? (options.motion === "reduced" ? o : 1) : 0;

    /* Paper and ruling. */
    (u.uPaper.value as Vector3).fromArray(tokens.paper);
    (u.uBack.value as Vector3).fromArray(tokens.back);
    (u.uRuleColor.value as Vector3).fromArray(tokens.rule);
    (u.uRuleStrong.value as Vector3).fromArray(tokens.ruleStrong);
    (u.uMarginColor.value as Vector3).fromArray(tokens.margin);
    (u.uDotColor.value as Vector3).fromArray(tokens.dot);
    u.uRuling.value = { none: 0, lines: 1, grid: 2, dots: 3 }[options.ruling];
    (u.uRule.value as Vector4).set(Math.max(4, layout.line), layout.firstLine, options.ruling === "lines" ? (layout.rtl ? this.width * 0.88 : this.width * 0.12) : -1, Math.max(4, tokens.grid));
    const paper = papers[options.paper];
    u.uGrain.value = paper.grain;
    u.uFiberAngle.value = this.fiberAngle;
    u.uTranslucency.value = paper.translucency;
    (u.uFinish.value as Vector3).fromArray(finishes[options.finish]);
    u.uCorner.value = Math.min(this.cornerRadius, Math.min(this.width, this.height) / 2);

    /* Light: the key from the site's angle, the rim opposite, the lamp at the pointer. */
    const angle = (tokens.lightAngle * Math.PI) / 180;
    const keyDir = this.keyDir.set(Math.sin(angle) * Math.cos(KEY_ELEVATION), Math.cos(angle) * Math.cos(KEY_ELEVATION), Math.sin(KEY_ELEVATION));
    const rimDir = this.rimDir.set(-Math.sin(angle) * Math.cos(RIM_ELEVATION), -Math.cos(angle) * Math.cos(RIM_ELEVATION), Math.sin(RIM_ELEVATION));
    const share = full ? this.lampShare.value : 0;
    const keyGain = 1 - LAMP_KEY_DIM * share;
    const rimGain = RIM_SHARE * tokens.lightRim;
    const lampGain = LAMP_GAIN * options.light * share;
    const lampHeight = LAMP_HEIGHT * longSide;
    const reach = LAMP_REACH * longSide;
    (u.uKeyDir.value as Vector3).copy(keyDir);
    (u.uKeyColor.value as Vector3).fromArray(tokens.key).multiplyScalar(keyGain);
    (u.uRimDir.value as Vector3).copy(rimDir);
    (u.uRimColor.value as Vector3).fromArray(tokens.key).multiplyScalar(rimGain);
    (u.uLampPos.value as Vector3).set(this.lampX.value, this.lampY.value, lampHeight);
    (u.uLampColor.value as Vector3).fromArray(tokens.lamp).multiplyScalar(lampGain);
    u.uLampReach.value = reach;
    (u.uSky.value as Vector3).fromArray(tokens.sky).multiplyScalar(SKY_WEIGHT);
    (u.uBounce.value as Vector3).fromArray(tokens.bounce).multiplyScalar(BOUNCE_WEIGHT);
    /* Exposure: a flat, level, unshadowed point under the lamp shows exactly the paper's color. */
    const wrap = (nl: number) => Math.max(0, (nl + 0.18) / 1.18);
    const keyFlat = wrap(Math.sin(KEY_ELEVATION)) * keyGain;
    const rimFlat = wrap(Math.sin(RIM_ELEVATION)) * rimGain;
    const lampFlat = lampGain / (1 + (lampHeight / reach) ** 2);
    const exposure = [0, 1, 2].map((c) => 1 / Math.max(1e-3, tokens.key[c] * (keyFlat + rimFlat) + tokens.lamp[c] * lampFlat + tokens.sky[c] * SKY_WEIGHT));
    (u.uExposure.value as Vector3).fromArray(exposure);

    /* Shadows: the key (blended toward the lamp) for the self shadow and the ground, and the ambient map from below for the ground. */
    const selfShadow = full ? 1 - smoothstep(0.9, 1, o) : 0;
    u.uSelfShadow.value = selfShadow;
    const groundOn = options.shadow;
    const b = this.bounds;
    const lampDir = this.lampDir.set(this.lampX.value - b.center.x, this.lampY.value - b.center.y, lampHeight - b.center.z).normalize();
    const lightDir = this.lightDir.copy(keyDir).lerp(lampDir, share * 0.85).normalize();
    const small = longSide < 300;
    const keyMap = small ? keyTargetSmall! : keyTarget!;
    const shadowRange = u.uShadowRange.value as Vector3;
    const ground = this.ground!;
    const mesh = this.mesh!;
    if (selfShadow > 0 || groundOn) {
      const r = b.radius;
      const cam = this.keyCamera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      /* Deep enough to reach the page under the long, raking shadow beyond the sheet's bounds. */
      cam.far = 6 * r + 2;
      cam.position.copy(b.center).addScaledVector(lightDir, r + 1);
      cam.up.set(0, 0, 1);
      if (Math.abs(lightDir.z) > 0.95) cam.up.set(0, 1, 0);
      cam.lookAt(b.center);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      (u.uShadowMatrix.value as Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      /* Depth range and footprint in pixels, then the map's resolution (0 when there is no map), from which the shader sizes its bias. */
      shadowRange.set(cam.far - cam.near, 2 * r, small ? KEY_SHADOW_SMALL : KEY_SHADOW_SIZE);
      this.depthPass(gl, keyMap, cam, ground, mesh);
      u.uShadowMap.value = keyMap.depthTexture;
    } else {
      shadowRange.set(1, 1, 0);
      u.uShadowMap.value = keyMap.depthTexture;
    }
    const gu = this.groundUniforms;
    ground.visible = groundOn;
    if (groundOn) {
      const [sr, sg, sb, sa] = tokens.shadow;
      (gu.uShadowColor.value as Vector4).set(sr, sg, sb, sa);
      const halo = 0.012 * longSide;
      const reachAmbient = 0.12 * longSide;
      gu.uAmbientReach.value = reachAmbient;
      gu.uHalo.value = halo;
      (gu.uCanvasHalf.value as Vector2).set(cssW / 2, cssH / 2);
      gu.uEdgeFade.value = Math.max(1, this.bleed * 0.7);
      gu.uShadowFade.value = SHADOW_FADE * longSide;
      const margin = halo + 0.8 * reachAmbient * 2 + 8;
      const cam = this.ambientCamera;
      const halfW = (b.maxX - b.minX) / 2 + margin;
      const halfH = (b.maxY - b.minY) / 2 + margin;
      const below = 10;
      cam.left = -halfW;
      cam.right = halfW;
      cam.top = halfH;
      cam.bottom = -halfH;
      cam.near = 1;
      cam.far = below + b.maxZ + 30;
      cam.position.set(b.center.x, b.center.y, -below);
      cam.up.set(0, 1, 0);
      cam.lookAt(b.center.x, b.center.y, 0);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      (gu.uAmbientMatrix.value as Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      (gu.uAmbientRange.value as Vector3).set(-below + cam.near, cam.far - cam.near, 1);
      this.depthPass(gl, ambientTarget!, cam, ground, mesh);
      gu.uAmbientMap.value = ambientTarget!.depthTexture;
    }

    /* The color pass into the top-left corner of the shared canvas, then the copy. */
    if (this.pw > sharedWidth || this.ph > sharedHeight) {
      sharedWidth = Math.max(sharedWidth, this.pw);
      sharedHeight = Math.max(sharedHeight, this.ph);
      gl.setSize(sharedWidth, sharedHeight, false);
    }
    gl.setRenderTarget(null);
    gl.setViewport(0, sharedHeight - this.ph, this.pw, this.ph);
    gl.setScissor(0, sharedHeight - this.ph, this.pw, this.ph);
    gl.setScissorTest(true);
    /* three's clear leaves the color mask as the last material set it, and the depth passes turn color writes off. */
    gl.state.buffers.color.setMask(true);
    gl.clear(true, true, false);
    gl.render(this.scene!, this.camera);
    gl.setScissorTest(false);
    const target = this.context2d;
    if (target) {
      target.clearRect(0, 0, this.pw, this.ph);
      target.drawImage(gl.domElement, 0, 0, this.pw, this.ph, 0, 0, this.pw, this.ph);
    }
  }

  private depthPass(gl: WebGLRenderer, target: WebGLRenderTarget, camera: OrthographicCamera, ground: Mesh, mesh: Mesh) {
    const groundVisible = ground.visible;
    ground.visible = false;
    mesh.material = this.depthMaterial!;
    gl.setRenderTarget(target);
    gl.setScissorTest(false);
    gl.clear(true, true, false);
    gl.render(this.scene!, camera);
    gl.setRenderTarget(null);
    mesh.material = this.material!;
    ground.visible = groundVisible;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.repaintTimer);
    this.resize.disconnect();
    this.visibility.disconnect();
    this.mutations.disconnect();
    this.face.removeEventListener("load", this.onLoad, true);
    document.fonts?.removeEventListener?.("loadingdone", this.onLoad);
    leaveJobs(this, null);
    if (this.creaseKey) releaseCreaseMap(this.creaseKey);
    this.creaseKey = "";
    this.geometry?.dispose();
    this.ground?.geometry.dispose();
    this.material?.dispose();
    this.depthMaterial?.dispose();
    this.groundMaterial?.dispose();
    this.inkLayer?.dispose();
    this.printLayer?.dispose();
    for (const key of ["state", "live", "busy", "fallback"]) delete this.root.dataset[key];
    this.root.style.removeProperty("--crumple-bleed");
  }
}

export function attachSheet(root: HTMLElement, canvas: HTMLCanvasElement, face: HTMLElement, options: SheetOptions, open: boolean, callbacks: SheetCallbacks): SheetHandle | null {
  window.clearTimeout(releaseTimer);
  if (rendererFailed || !ensureRenderer()) {
    root.dataset.fallback = "";
    return null;
  }
  const sheet = new Sheet(root, canvas, face, options, open, callbacks);
  sheets.add(sheet);
  listen(true);
  wake();
  return {
    setOptions: (next) => sheet.setOptions(next),
    setTarget: (next, instant) => sheet.setTarget(next, instant),
    setProgress: (progress) => sheet.setProgress(progress),
    setScroll: (scrub) => sheet.setScroll(scrub),
    setAffordance: (hover, press) => sheet.setAffordance(hover, press),
    invalidateInk: () => sheet.invalidateInk(),
    dispose: () => {
      sheet.dispose();
      sheets.delete(sheet);
      if (!sheets.size) {
        listen(false);
        if (loop) cancelAnimationFrame(loop);
        loop = 0;
        releaseTimer = window.setTimeout(releaseRenderer, RELEASE_DELAY);
      }
    },
  };
}
