"use client";

import { NOISE_GLSL, ShaderCanvas } from "./ShaderCanvas";

/**
 * The home page's hero: ruled paper. A square grid of hairlines drifts slowly across the page's ground; the cells under the pointer fill in, brightest at the pointer and fading over a few cells, and now and then a cell lights by itself. It fades toward the edges and stays quiet behind the headline. Monochrome, from the theme's tokens.
 */
const FRAGMENT = `
uniform vec2 u_res; uniform float u_time; uniform float u_dpr;
uniform vec2 u_pointer; uniform float u_hover;
uniform vec3 u_ground; uniform vec3 u_ink;
${NOISE_GLSL}
const float CELL = 48.0;
void main(){
  // Work in CSS pixels, so a cell is the same size on every screen.
  vec2 px = gl_FragCoord.xy / u_dpr;
  vec2 size = u_res / u_dpr;
  vec2 drift = vec2(u_time * 2.2, u_time * 1.3);
  vec2 g = (px + drift) / CELL;
  vec2 id = floor(g);
  vec2 f = fract(g);
  // Distance to the nearest rule, in pixels: a rule is one device pixel wide.
  float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * CELL;
  float rule = 1.0 - smoothstep(0.5 / u_dpr, 1.5 / u_dpr, d);

  // Cells near the pointer fill in. The distance is measured from each cell's centre, so a cell is one flat tone.
  vec2 centre = (id + 0.5) * CELL - drift;
  float away = length(centre - u_pointer * size) / CELL;
  float lit = u_hover * exp(-away * away * 0.22);

  // A few cells light by themselves and fade, so the page is alive before the pointer arrives.
  float beat = u_time * 0.25;
  float spark = hash(id + floor(beat) * 17.0);
  float twinkle = step(0.988, spark) * sin(fract(beat) * 3.14159);

  float ink = rule * (0.10 + 0.20 * lit) + 0.07 * lit + 0.06 * twinkle;

  // Fade toward the edges, and leave the middle, where the headline sits, quieter.
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float edge = smoothstep(1.2, 0.3, length(p * vec2(0.7, 1.0)));
  float middle = 1.0 - 0.6 * exp(-dot(p * vec2(0.9, 1.7), p * vec2(0.9, 1.7)) * 3.0) * (1.0 - lit);
  gl_FragColor = vec4(mix(u_ground, u_ink, clamp(ink * edge * middle, 0.0, 1.0)), 1.0);
}`;

export function HeroGrid({ className }: { className?: string }) {
  return <ShaderCanvas fragment={FRAGMENT} colors={{ ground: "var(--background)", ink: "var(--foreground)" }} interactive className={className} />;
}
