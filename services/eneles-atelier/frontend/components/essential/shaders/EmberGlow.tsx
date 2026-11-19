"use client";

import { NOISE_GLSL, ShaderCanvas } from "./ShaderCanvas";

/**
 * The closing call to action's ground: a slow, warm glow in the theme's orange, like embers under the card. Two layers of noise warp each other so the light folds and drifts; it rises from the lower end of the card and the side where the pages lie, and stays dark behind the text at the start. The pointer warms the light around it while it is over the card. Colors from the theme (`--card`, `--hue-orange`, `--hue-amber`).
 */
const FRAGMENT = `
uniform vec2 u_res; uniform float u_time; uniform float u_dpr;
uniform vec2 u_pointer; uniform float u_hover;
uniform vec3 u_ground; uniform vec3 u_ember; uniform vec3 u_flare;
${NOISE_GLSL}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.045;
  // Domain warp: noise moves the coordinates of more noise, so the light folds instead of blobbing.
  vec2 q = vec2(fbm(p * 1.6 + vec2(0.0, t)), fbm(p * 1.6 + vec2(5.2, -t * 0.8)));
  vec2 r = vec2(fbm(p * 2.1 + 3.0 * q + vec2(1.7, 9.2) + t), fbm(p * 2.1 + 3.0 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.8 + 2.6 * r);
  // Where the glow lives: rising from the bottom, strongest at the far end (where the pages are), dark at the start, where the headline is.
  float side = smoothstep(0.15, 0.95, uv.x);
  float rise = smoothstep(1.05, 0.0, uv.y);
  float place = clamp(0.25 * rise + 0.85 * side * (0.45 + 0.55 * rise), 0.0, 1.0);
  // The pointer warms what is near it.
  vec2 size = u_res / u_dpr;
  float near = exp(-pow(length((uv - u_pointer) * vec2(size.x / size.y, 1.0)) * 2.6, 2.0));
  float heat = clamp(f * f * 1.9 * place + 0.35 * near * u_hover * (0.4 + f), 0.0, 1.0);
  vec3 col = mix(u_ground, u_ember, smoothstep(0.05, 0.75, heat) * 0.55);
  col = mix(col, u_flare, smoothstep(0.55, 1.0, heat) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

export function EmberGlow({ className }: { className?: string }) {
  return <ShaderCanvas fragment={FRAGMENT} colors={{ ground: "var(--card)", ember: "var(--hue-orange)", flare: "var(--hue-amber)" }} interactive className={className} />;
}
