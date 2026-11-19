"use client";

import { useMemo } from "react";
import { NOISE_GLSL, ShaderCanvas } from "./ShaderCanvas";

/**
 * The ground of the status pages (404, 403, the error boundary, offline): the home page's ruled paper (HeroGrid: the same 48px cells, hairline rules, drift, and edge fade) with some of its cells come loose. On its own clock a loose cell lifts out of the sheet, slides off by part of a cell with its outline drawn where it went, leaves its ruling missing where it was, and slides back. The cells near the pointer light up as on the home page and settle into place. One parameter varies between the pages: `disorder`, the share of cells that may come loose, so every status page is the same picture in a different state.
 *
 * Colors come from the theme through ShaderCanvas, which also stops the loop in a hidden tab or off screen, draws one still frame under Reduced and Off motion, and leaves the plain page background when WebGL is unavailable.
 */
function fragment(disorder: number) {
  return `
uniform vec2 u_res; uniform float u_time; uniform float u_dpr;
uniform vec2 u_pointer; uniform float u_hover;
uniform vec3 u_ground; uniform vec3 u_ink;
${NOISE_GLSL}
const float CELL = 48.0;
const float DISORDER = ${disorder.toFixed(3)};
vec2 hash2(vec2 p){ return vec2(hash(p), hash(p + 19.19)); }

// A cell's state in paper space: how far it has slid (CSS pixels) and how lifted it is (0 to 1).
vec3 cellState(vec2 id, vec2 drift, vec2 size){
  float clock = u_time * (0.09 + 0.07 * hash(id + 2.0)) + hash(id) * 9.0;
  float slot = floor(clock);
  float phase = fract(clock);
  float loose = step(1.0 - DISORDER, hash(id + slot * 3.1));
  float lift = smoothstep(0.04, 0.2, phase) * (1.0 - smoothstep(0.68, 0.86, phase)) * loose;
  vec2 centre = (id + 0.5) * CELL - drift;
  float away = length(centre - u_pointer * size) / CELL;
  lift *= 1.0 - u_hover * exp(-away * away * 0.3);
  vec2 dir = hash2(id + slot) - 0.5;
  return vec3(dir * CELL * 0.55 * lift, lift);
}

// Distance in CSS pixels from q to the edge of the square [lo, lo + CELL], negative inside.
float boxEdge(vec2 q, vec2 lo){
  vec2 d = abs(q - lo - 0.5 * CELL) - 0.5 * CELL;
  return max(d.x, d.y);
}

void main(){
  vec2 px = gl_FragCoord.xy / u_dpr;
  vec2 size = u_res / u_dpr;
  vec2 drift = vec2(u_time * 2.2, u_time * 1.3);
  vec2 q = px + drift;
  vec2 home = floor(q / CELL);
  vec2 f = fract(q / CELL);
  float hair = 0.5 / u_dpr;
  float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * CELL;
  float rule = 1.0 - smoothstep(hair, 3.0 * hair, d);

  // Where a cell has lifted away, its own ruling is missing.
  vec3 own = cellState(home, drift, size);
  rule *= 1.0 - 0.85 * own.z;

  // The pointer lights the cells near it, as on the home page.
  vec2 centre = (home + 0.5) * CELL - drift;
  float away = length(centre - u_pointer * size) / CELL;
  float lit = u_hover * exp(-away * away * 0.22);

  // Lifted cells nearby, drawn where they slid to: an outline and a faint face.
  float outline = 0.0;
  float face = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = home + vec2(float(i), float(j));
      vec3 s = cellState(id, drift, size);
      if (s.z < 0.01) continue;
      float e = boxEdge(q, id * CELL + s.xy);
      outline = max(outline, (1.0 - smoothstep(hair, 3.0 * hair, abs(e))) * s.z);
      face = max(face, step(e, 0.0) * s.z);
    }
  }

  float beat = u_time * 0.25;
  float twinkle = step(0.988, hash(home + floor(beat) * 17.0)) * sin(fract(beat) * 3.14159);

  // Fade toward the edges, and keep the middle, where the status and its sentence sit, quiet: the loose cells fade out there entirely.
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float edge = smoothstep(1.1, 0.25, length(p * vec2(0.7, 1.0)));
  float calm = exp(-dot(p * vec2(1.0, 1.7), p * vec2(1.0, 1.7)) * 3.0);
  float middle = 1.0 - 0.7 * calm * (1.0 - lit);
  float loose = (outline * 0.32 + face * 0.05) * (1.0 - 0.9 * calm);
  float ink = rule * (0.10 + 0.20 * lit) + 0.07 * lit + 0.06 * twinkle;
  gl_FragColor = vec4(mix(u_ground, u_ink, clamp((ink * middle + loose) * edge, 0.0, 1.0)), 1.0);
}`;
}

const COLORS = { ground: "var(--background)", ink: "var(--foreground)" };

export function StatusGrid({ disorder, className }: { /** The share of cells that may come loose, 0 to 1; the status pages use 0.04 to 0.16. */ disorder: number; className?: string }) {
  const source = useMemo(() => fragment(Math.min(1, Math.max(0, disorder))), [disorder]);
  return <ShaderCanvas fragment={source} colors={COLORS} interactive className={className} />;
}
