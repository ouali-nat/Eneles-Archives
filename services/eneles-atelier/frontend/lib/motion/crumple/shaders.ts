import { pcgGlsl } from "@/lib/motion/crumple/hash";

/* GLSL ES 3.00 for the crumple engine, written for three's RawShaderMaterial (nothing is injected but the version line and defines). Five programs: the crease-map pass (rendered once per shape, fold, and size into a mipmapped texture), the sheet (vertex and fragment), its depth pass for the two shadow maps, and the ground that receives the shadows. World units are CSS pixels with the page at z = 0; sheet coordinates `q` are pixels from the sheet's bottom-left corner, so grain, ruling, and creases move with the paper and never swim.

Credits: the integer hash is PCG (Jarzynski and Olano 2020, hash.ts); the facet edge distance is the two-pass Voronoi border distance described by Inigo Quilez, written here from the description; the normal perturbation uses a cotangent frame from screen-space derivatives, without precomputed tangents (Christian Schuler, "Normal Mapping Without Precomputed Tangents", 2013); the specular lobe is GGX with Schlick's Fresnel and the Smith-Schlick visibility term. */

const prelude = /* glsl */ `
precision highp float;
precision highp int;
#define PI 3.14159265359
${pcgGlsl}
float valueNoise(vec2 p, uint seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash3(i.x, i.y, seed);
  float b = hash3(i.x + 1, i.y, seed);
  float c = hash3(i.x, i.y + 1, seed);
  float d = hash3(i.x + 1, i.y + 1, seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 toLinear(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;

/* The flat sheet's relief, in pixels along z: letter folds that keep a residual angle (the outer panels rise from each valley), seeded corner lifts, and a gentle waviness. Evaluated by the vertex shaders for the geometry and by the fragment shader for its gradient, so a letter fold shades crisply even between vertices. */
const relief = /* glsl */ `
uniform vec2 uSize;
uniform vec4 uFoldRelief;
uniform vec4 uCornerLift;
uniform vec3 uWave;
uniform uint uSeed;
float bendAbs(float d, float r) { return sqrt(d * d + r * r) - r; }
float bendOne(float d, float r) { return 0.5 * (sqrt(d * d + r * r) + d); }
float lift(vec2 q, vec2 corner, float amount, float reach) {
  float t = max(0.0, 1.0 - length(q - corner) / reach);
  return amount * pow(t, 2.2);
}
float relief(vec2 q) {
  float h = 0.0;
  float slope = uFoldRelief.y;
  float radius = uFoldRelief.z;
  if (uFoldRelief.x > 0.5 && uFoldRelief.x < 1.5) h += slope * bendAbs(q.y - 0.5 * uSize.y, radius);
  if (uFoldRelief.x > 1.5) h += slope * (bendOne(q.y - uSize.y * (2.0 / 3.0), radius) + bendOne(uSize.y / 3.0 - q.y, radius));
  float reach = 0.3 * min(uSize.x, uSize.y);
  h += lift(q, vec2(0.0), uCornerLift.x, reach);
  h += lift(q, vec2(uSize.x, 0.0), uCornerLift.y, reach);
  h += lift(q, vec2(0.0, uSize.y), uCornerLift.z, reach);
  h += lift(q, uSize, uCornerLift.w, reach);
  vec2 w = q * (uWave.y / max(uSize.x, uSize.y)) + uWave.z;
  h += uWave.x * ((valueNoise(w, uSeed) - 0.5) * 1.4 + (valueNoise(w * 2.03 + 7.1, uSeed + 1u) - 0.5) * 0.6);
  return h;
}
`;

/* Fullscreen triangle for the crease-map pass. */
export const passVertex = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/* The crease map: four layers of Voronoi facets, each cell tilted by a random slope (larger facets tilt less) and rounded toward its neighbor's slope near the edge between them, plus the seeded major folds and the letter folds as slope jumps across lines. Encoded as RGBA: the unit normal's x and y (biased into 0..1), cavity (ridges above one half catch light, valleys below hold a little shadow), and wear (ink cracked off along sharp ridges in broken hairlines, and rubbed edges). */
export const creaseFragment = /* glsl */ `
${prelude}
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uSize;
uniform vec2 uMaterial;
uniform uint uSeed;
uniform vec4 uLayers[4];
uniform int uLineCount;
uniform vec4 uLineA[8];
uniform vec4 uLineB[8];
uniform float uCoarseWidth;

vec2 site(ivec2 c, uint seed) {
  return vec2(c) + 0.5 + (hash3v(c.x, c.y, seed) - 0.5) * 0.8;
}
vec2 tilt(ivec2 c, uint seed) {
  vec2 h = hash3v(c.x, c.y, seed ^ 2654435769u);
  float a = h.x * 2.0 * PI;
  return vec2(cos(a), sin(a)) * sqrt(h.y);
}
float breakup(float t, uint seed) {
  return smoothstep(0.6, 0.72, valueNoise(vec2(t, 3.7), seed));
}
void facets(vec2 q, vec4 layer, uint seed, float density, inout vec2 slope, inout float cavity, inout float wear) {
  float cellPx = layer.x;
  vec2 g = q / cellPx;
  ivec2 base = ivec2(floor(g));
  float best = 1e9;
  ivec2 nearest = base;
  vec2 nearestP = vec2(base) + 0.5;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 c = base + ivec2(i, j);
      vec2 p = site(c, seed);
      vec2 d = p - g;
      float dd = dot(d, d);
      if (dd < best) {
        best = dd;
        nearest = c;
        nearestP = p;
      }
    }
  float edge = 1e9;
  ivec2 other = nearest;
  vec2 otherP = nearestP + vec2(1.0, 0.0);
  for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++) {
      if (i == 0 && j == 0) continue;
      ivec2 c = nearest + ivec2(i, j);
      vec2 p = site(c, seed);
      vec2 diff = p - nearestP;
      float len2 = dot(diff, diff);
      if (len2 < 1e-6) continue;
      float e = dot(0.5 * (nearestP + p) - g, diff * inversesqrt(len2));
      if (e < edge) {
        edge = e;
        other = c;
        otherP = p;
      }
    }
  float e = max(0.0, edge) * cellPx;
  float w = layer.z;
  vec2 s1 = tilt(nearest, seed) * layer.y * density;
  vec2 s2 = tilt(other, seed) * layer.y * density;
  slope += s1 + (s2 - s1) * 0.5 * (1.0 - smoothstep(0.0, w, e));
  vec2 n12 = normalize(otherP - nearestP);
  float delta = dot(s2 - s1, n12);
  cavity += clamp(-4.0 * delta, -0.5, 0.5) * (1.0 - smoothstep(0.0, 2.5 * w, e));
  if (-delta > 0.05) wear = max(wear, (1.0 - smoothstep(0.0, 0.8, e)) * breakup(dot(q, vec2(-n12.y, n12.x)) / 5.0, seed + 17u));
}

void main() {
  vec2 q = vUv * uSize;
  float longSide = max(uSize.x, uSize.y);
  vec2 slope = vec2(0.0);
  float cavity = 0.0;
  float wear = 0.0;
  float density = mix(0.35, 1.5, smoothstep(0.15, 0.85, valueNoise(q / (0.28 * longSide), uSeed + 5u)));
  for (int k = 0; k < 4; k++) {
    vec4 layer = uLayers[k];
    if (layer.w < 0.5) continue;
    facets(q, layer, uSeed + uint(k) * 7919u, k >= 2 ? density : 1.0, slope, cavity, wear);
  }
  vec2 m = vUv * uMaterial;
  for (int k = 0; k < 8; k++) {
    if (k >= uLineCount) break;
    vec4 a = uLineA[k];
    vec4 b = uLineB[k];
    vec2 r = m - a.xy;
    vec2 normal = vec2(-a.w, a.z);
    float along = dot(r, a.zw);
    float across = dot(r, normal) * longSide;
    float taper = b.z > 0.5 ? 1.0 - smoothstep(0.8 * b.x, b.x, abs(along)) : 1.0;
    if (taper <= 0.0) continue;
    float w = b.w > 0.0 ? b.w : uCoarseWidth;
    float side = across * inversesqrt(across * across + w * w);
    slope += normal * (0.5 * b.y) * side * taper;
    float near = 1.0 - smoothstep(0.0, 2.5 * w, abs(across));
    cavity += clamp(-4.0 * b.y, -0.5, 0.5) * near * taper;
    if (b.y < 0.0) wear = max(wear, (1.0 - smoothstep(0.0, 0.8, abs(across))) * taper * breakup(along * longSide / 5.0, uSeed + uint(k) + 31u));
  }
  float border = min(min(q.x, uSize.x - q.x), min(q.y, uSize.y - q.y));
  wear = max(wear, 0.25 * (1.0 - smoothstep(0.0, 3.0, border)) * valueNoise(q / 2.5, uSeed + 41u));
  vec3 n = normalize(vec3(-slope, 1.0));
  fragColor = vec4(n.xy * 0.5 + 0.5, clamp(0.5 + cavity, 0.0, 1.0), clamp(wear, 0.0, 1.0));
}
`;

/* The sheet's geometry: the track's pose from the CPU, plus the relief near flat. Near flat, x and y are scaled toward the camera's axis by the height above the page, which cancels perspective, so the paper lands exactly under the DOM content laid over it. Shared by the color pass and both depth passes. */
export const sheetVertex = /* glsl */ `
${prelude}
${relief}
in vec3 position;
in vec3 normal;
in vec2 uv;
in float ao;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uRelief;
uniform float uRegister;
uniform float uCameraZ;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vAo;
void main() {
  vec3 p = position;
  p.z += relief(uv * uSize) * uRelief;
  p.xy *= mix(1.0, (uCameraZ - p.z) / uCameraZ, uRegister);
  vWorld = p;
  vNormal = normal;
  vUv = uv;
  vAo = ao;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const depthFragment = /* glsl */ `
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0);
}
`;

/* Soft shadows from an orthographic depth map: a blocker search, then percentage-closer filtering over a rotated Poisson disk whose radius grows with the distance to the blocker, so the ball's shadow is crisp where it touches and soft away from it. */
const shadows = /* glsl */ `
uniform highp sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowRange;
const vec2 POISSON[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);
float shadowAt(vec3 world, float bias, out float gap) {
  gap = 0.0;
  if (uShadowRange.z < 0.5) return 0.0;
  vec3 s = (uShadowMatrix * vec4(world, 1.0)).xyz * 0.5 + 0.5;
  if (s.x <= 0.0 || s.y <= 0.0 || s.x >= 1.0 || s.y >= 1.0 || s.z >= 1.0) return 0.0;
  float depthPx = uShadowRange.x;
  float uvPerPx = 1.0 / uShadowRange.y;
  float receiver = s.z * depthPx - bias;
  float angle = hash3(int(gl_FragCoord.x), int(gl_FragCoord.y), 977u) * 2.0 * PI;
  mat2 spin = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
  float found = 0.0;
  float total = 0.0;
  for (int i = 0; i < 6; i++) {
    float d = texture(uShadowMap, s.xy + spin * POISSON[i * 2] * (18.0 * uvPerPx)).r * depthPx;
    if (d < receiver) {
      total += d;
      found += 1.0;
    }
  }
  if (found < 0.5) return 0.0;
  gap = receiver - total / found;
  float penumbra = clamp(2.0 + gap * 0.12, 2.0, 36.0);
  float occluded = 0.0;
  for (int i = 0; i < 12; i++) {
    float d = texture(uShadowMap, s.xy + spin * POISSON[i] * (penumbra * uvPerPx)).r * depthPx;
    occluded += step(d, receiver);
  }
  return occluded / 12.0;
}
`;

/* The paper: front and back albedo (paper token, grain, ruling, the print, the painted ink), the crease map through a cotangent frame, the relief's gradient, and the site's lights (a raking key from --light-angle, the rim, a cursor lamp, sky and bounce) normalized so a flat, level, unshadowed point shows exactly the paper's color. Corners are cut by a rounded-rectangle distance with alpha to coverage. */
export const sheetFragment = /* glsl */ `
${prelude}
${relief}
${shadows}
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vAo;
out vec4 fragColor;
uniform float uRelief;
uniform float uFacet;
uniform vec3 uEye;
/* High precision: the crease map is half float, and a fragment shader's samplers default to low precision, which would band its small slopes on phones. */
uniform highp sampler2D uCreaseMap;
uniform float uCreaseScale;
/* The painted ink, premultiplied as the 2D canvas stores it and sampled undecoded, so it is unpremultiplied in the space it was multiplied in and only then turned linear. */
uniform sampler2D uInk;
uniform float uInkAmount;
uniform int uInkBlend;
uniform sampler2D uPrint;
uniform vec4 uPrintRect;
uniform float uPrintAmount;
uniform vec3 uPaper;
uniform vec3 uBack;
uniform vec3 uRuleColor;
uniform vec3 uRuleStrong;
uniform vec3 uMarginColor;
uniform vec3 uDotColor;
uniform int uRuling;
uniform vec4 uRule;
uniform float uGrain;
uniform float uFiberAngle;
uniform float uTranslucency;
uniform vec3 uFinish;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uRimDir;
uniform vec3 uRimColor;
uniform vec3 uLampPos;
uniform vec3 uLampColor;
uniform float uLampReach;
uniform vec3 uSky;
uniform vec3 uBounce;
uniform vec3 uExposure;
uniform float uSelfShadow;
uniform float uCorner;

float lineCover(float distance, float width, float fw) {
  return clamp((0.5 * width - distance) / fw + 0.5, 0.0, 1.0) * min(1.0, width / fw);
}

/* Formation blotches, machine-direction fibers (returned as a small normal tilt), and sparse flecks, faded out where a sheet pixel is smaller than a screen pixel so the ball does not alias. */
float grain(vec2 q, float fw, out vec2 fiberTilt) {
  float detail = 1.0 - smoothstep(0.7, 1.6, fw);
  float formation = valueNoise(q / 28.0, uSeed + 61u) - 0.5;
  float c = cos(uFiberAngle);
  float s = sin(uFiberAngle);
  vec2 r = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  vec2 f = vec2(valueNoise(r / vec2(9.0, 3.0), uSeed + 67u), valueNoise(r / vec2(9.0, 3.0) + 19.3, uSeed + 71u)) - 0.5;
  fiberTilt = f * 0.06 * detail;
  vec2 cell = floor(q / 3.0);
  vec2 h = hash3v(int(cell.x), int(cell.y), uSeed + 73u);
  float fleck = 0.0;
  if (h.x < 0.0035 * uGrain) {
    vec2 at = (cell + 0.5 + (h - 0.5) * 0.6) * 3.0;
    float size = mix(0.5, 1.0, fract(h.y * 7.0));
    float cover = 1.0 - smoothstep(size - 0.5, size + 0.5, length(q - at));
    fleck = cover * (h.y < 0.5 ? -0.09 : 0.06) * detail;
  }
  return 1.0 + formation * 0.03 * uGrain + fleck;
}

vec3 ruling(vec2 q, vec3 albedo) {
  if (uRuling == 0) return albedo;
  float yTop = uSize.y - q.y;
  vec2 fw = max(fwidth(q), vec2(1e-3));
  if (uRuling == 1) {
    float t = (yTop - uRule.y) / uRule.x;
    float d = abs(fract(t + 0.5) - 0.5) * uRule.x;
    float line = t > -0.5 ? lineCover(d, 1.0, fw.y) : 0.0;
    albedo = mix(albedo, uRuleColor, line);
    if (uRule.z >= 0.0) albedo = mix(albedo, uMarginColor, lineCover(abs(q.x - uRule.z), 1.0, fw.x));
    return albedo;
  }
  /* The lattice is centered on the sheet the way the CSS still's centered tiles are: majors every fifth line from a centered major tile, dots at the centers of centered tiles. */
  float g = uRule.w;
  if (uRuling == 2) {
    vec2 p = vec2(q.x, yTop) - mod(0.5 * uSize - 2.5 * g, 5.0 * g);
    vec2 index = floor(p / g + 0.5);
    vec2 d = abs(p - index * g);
    /* Every fifth line, by distance to the nearest multiple of five rather than a float equality, which a GPU's approximate division can miss. */
    vec2 major = step(abs(index - 5.0 * floor(index / 5.0 + 0.5)), vec2(0.5));
    float minor = max(lineCover(d.x, 1.0, fw.x) * (1.0 - major.x), lineCover(d.y, 1.0, fw.y) * (1.0 - major.y));
    float strong = max(lineCover(d.x, 1.0, fw.x) * major.x, lineCover(d.y, 1.0, fw.y) * major.y);
    albedo = mix(albedo, uRuleColor, minor * 0.8);
    return mix(albedo, uRuleStrong, strong);
  }
  vec2 p = vec2(q.x, yTop) - mod(0.5 * uSize, g);
  vec2 d = abs(p - floor(p / g + 0.5) * g);
  float r = length(d);
  float f = max(fw.x, fw.y);
  return mix(albedo, uDotColor, clamp((1.1 - r) / f + 0.5, 0.0, 1.0));
}

float diffuseWrap(float nl) {
  return max(0.0, (nl + 0.18) / 1.18);
}

float ggx(vec3 n, vec3 v, vec3 l, float roughness, float f0) {
  vec3 h = normalize(v + l);
  float a = roughness * roughness;
  float a2 = a * a;
  float nh = max(dot(n, h), 0.0);
  float nl = max(dot(n, l), 0.0);
  float nv = max(dot(n, v), 1e-3);
  float vh = max(dot(v, h), 0.0);
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float distribution = a2 / (PI * dd * dd);
  float k = a * 0.5;
  float visibility = 1.0 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k));
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  return distribution * visibility * fresnel * nl * 0.25;
}

void main() {
  vec2 q = vUv * uSize;
  vec2 half_ = 0.5 * uSize;
  vec2 box = abs(q - half_) - (half_ - uCorner);
  float sd = length(max(box, 0.0)) + min(max(box.x, box.y), 0.0) - uCorner;
  float aa = max(fwidth(sd), 1e-3);
  float coverage = 1.0 - smoothstep(-aa, aa, sd);
  if (coverage <= 0.0) discard;

  bool front = gl_FrontFacing;
  vec3 dpx = dFdx(vWorld);
  vec3 dpy = dFdy(vWorld);
  vec3 facet = normalize(cross(dpx, dpy));
  vec3 facetFront = front ? facet : -facet;
  vec3 ng = normalize(mix(normalize(vNormal), facetFront, uFacet));
  vec3 facing = front ? ng : -ng;

  vec2 dqx = dFdx(q);
  vec2 dqy = dFdy(q);
  vec3 perp2 = cross(dpy, facing);
  vec3 perp1 = cross(facing, dpx);
  vec3 tangent = perp2 * dqx.x + perp1 * dqy.x;
  vec3 bitangent = perp2 * dqx.y + perp1 * dqy.y;
  float scale = inversesqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-12));
  tangent *= scale;
  bitangent *= scale;

  float fw = max(length(dqx), length(dqy));
  vec2 fiberTilt;
  float paperGrain = grain(q, fw, fiberTilt);

  vec4 crease = texture(uCreaseMap, vUv);
  vec2 creaseTilt = (crease.xy * 2.0 - 1.0) * uCreaseScale;
  float e = 0.75;
  vec2 gradient = vec2(relief(q + vec2(e, 0.0)) - relief(q - vec2(e, 0.0)), relief(q + vec2(0.0, e)) - relief(q - vec2(0.0, e))) / (2.0 * e) * uRelief;
  vec3 local = normalize(vec3(creaseTilt + fiberTilt - gradient, 1.0));
  vec3 nFront = normalize(tangent * local.x + bitangent * local.y + ng * local.z);
  vec3 n = front ? nFront : -nFront;

  float strength = clamp(uCreaseScale, 0.0, 1.3);
  float cavity = 0.5 + (crease.z - 0.5) * strength;
  float wear = crease.w * min(1.0, strength * 1.4);

  vec4 ink = texture(uInk, vUv);
  vec2 printMin = uPrintRect.xy * uSize;
  vec2 printMax = uPrintRect.zw * uSize;
  float printEdge = min(min(q.x - printMin.x, printMax.x - q.x), min(q.y - printMin.y, printMax.y - q.y));
  float printCover = clamp(printEdge / max(fw, 1e-3) + 0.5, 0.0, 1.0) * uPrintAmount;
  vec2 printUv = clamp((q - printMin) / max(printMax - printMin, vec2(1.0)), 0.0, 1.0);
  vec3 printColor = texture(uPrint, printUv).rgb;

  vec3 albedo;
  if (front) {
    albedo = ruling(q, uPaper) * paperGrain;
    albedo = mix(albedo, printColor, printCover * (1.0 - wear * 0.7));
    float inkAlpha = ink.a * uInkAmount * (1.0 - wear * 0.85);
    vec3 inkColor = toLinear(ink.rgb / max(ink.a, 1e-4));
    if (uInkBlend == 0) albedo *= mix(vec3(1.0), inkColor, inkAlpha);
    else albedo = 1.0 - (1.0 - albedo) * (1.0 - inkColor * inkAlpha);
  } else {
    float through = max(ink.a * uInkAmount, printCover);
    albedo = uBack * paperGrain * (1.0 - 0.08 * through);
  }

  float ao = vAo;
  float texel = uShadowRange.y / max(uShadowRange.z, 1.0);
  vec3 towardLight = dot(n, uKeyDir) >= 0.0 ? n : -n;
  float gap;
  float keyOcclusion = uSelfShadow > 0.0 ? shadowAt(vWorld + towardLight * (1.5 * texel + 0.5), 1.0 + 2.0 * texel * (1.0 - abs(dot(n, uKeyDir))), gap) * uSelfShadow : 0.0;
  /* White paper fills its own shadows with light bounced between its folds, so a shadowed facet keeps some of the key. */
  float lit = 1.0 - 0.72 * keyOcclusion;

  float nk = dot(n, uKeyDir);
  vec3 radiance = uKeyColor * (diffuseWrap(nk) + max(0.0, -nk) * uTranslucency) * lit;
  radiance += uRimColor * diffuseWrap(dot(n, uRimDir));
  vec3 toLamp = uLampPos - vWorld;
  float lampDistance = length(toLamp);
  vec3 lampDir = toLamp / max(lampDistance, 1e-3);
  float falloff = 1.0 / (1.0 + pow(lampDistance / uLampReach, 2.0));
  float nl = dot(n, lampDir);
  radiance += uLampColor * falloff * (diffuseWrap(nl) + max(0.0, -nl) * uTranslucency) * lit;
  radiance += (uSky * (0.5 + 0.5 * n.z) + uBounce * (0.5 - 0.5 * n.z)) * ao;
  radiance *= mix(1.0, ao, 0.5);

  vec3 view = normalize(uEye - vWorld);
  float specular = uFinish.z * (ggx(n, view, uKeyDir, uFinish.x, uFinish.y) * lit);
  vec3 shine = uKeyColor * specular + uLampColor * falloff * uFinish.z * ggx(n, view, lampDir, uFinish.x, uFinish.y) * lit;

  vec3 color = (albedo * radiance * (1.0 + (cavity - 0.5) * 0.35) + shine) * uExposure;
  /* Facets lit brighter than the paper roll off toward white instead of clipping; everything up to the paper's own brightness is untouched. */
  float knee = max(max(uPaper.r, uPaper.g), uPaper.b);
  vec3 over = max(color - knee, 0.0);
  color = min(color, vec3(knee)) + (1.0 - knee) * (1.0 - exp(-over / max(1.0 - knee, 1e-3)));
  fragColor = vec4(toSrgb(color) * coverage, coverage);
}
`;

/* The page under the sheet: transparent except for shadow, premultiplied in the shadow token's color. Key occlusion from the light's depth map, and ambient occlusion from a map looking up at the sheet's underside: the closer the paper is to the page above a point, the darker, over a disk that widens with the height, which seats the ball and draws the faint halo under a flat sheet and its lifted corners. */
export const groundVertex = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const groundFragment = /* glsl */ `
${prelude}
${shadows}
in vec3 vWorld;
out vec4 fragColor;
uniform vec4 uShadowColor;
uniform highp sampler2D uAmbientMap;
uniform mat4 uAmbientMatrix;
uniform vec3 uAmbientRange;
uniform float uAmbientReach;
uniform float uHalo;
uniform vec2 uCanvasHalf;
uniform float uEdgeFade;
uniform float uShadowFade;

float heightAt(vec2 xy) {
  vec3 s = (uAmbientMatrix * vec4(xy, 0.0, 1.0)).xyz * 0.5 + 0.5;
  if (s.x <= 0.0 || s.y <= 0.0 || s.x >= 1.0 || s.y >= 1.0) return 1e6;
  float d = texture(uAmbientMap, s.xy).r;
  if (d >= 0.9999) return 1e6;
  return uAmbientRange.x + d * uAmbientRange.y;
}

void main() {
  /* The key's shadow on the page lightens with its distance from what casts it, as a lamp's does. */
  float gap;
  float key = shadowAt(vWorld, 0.8, gap);
  key *= exp(-gap / max(uShadowFade, 1.0));
  float ambient = 0.0;
  if (uAmbientRange.z > 0.5) {
    /* The disk widens with the height of the paper above this point; where no paper is above, it stays the halo's width. */
    float above = heightAt(vWorld.xy);
    float radius = uHalo + 0.8 * (above < 1e5 ? min(above, uAmbientReach * 2.0) : 0.0);
    float angle = hash3(int(gl_FragCoord.x), int(gl_FragCoord.y), 433u) * 2.0 * PI;
    mat2 spin = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    ambient = 1.0 - smoothstep(0.0, uAmbientReach, heightAt(vWorld.xy));
    for (int i = 0; i < 8; i++) ambient += 1.0 - smoothstep(0.0, uAmbientReach, heightAt(vWorld.xy + spin * POISSON[i] * radius));
    ambient /= 9.0;
  }
  float alpha = uShadowColor.a * (1.0 - (1.0 - 0.7 * key) * (1.0 - 0.55 * ambient));
  /* A long raking shadow fades out before the stage's edge rather than being cut by it. */
  alpha *= smoothstep(0.0, uEdgeFade, min(uCanvasHalf.x - abs(vWorld.x), uCanvasHalf.y - abs(vWorld.y)));
  fragColor = vec4(toSrgb(uShadowColor.rgb) * alpha, alpha);
}
`;
