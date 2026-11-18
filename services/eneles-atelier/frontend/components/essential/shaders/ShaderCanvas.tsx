"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useMotion } from "@/hooks/useMotion";
import { cn } from "@/lib/utils";

/**
 * One full-bleed WebGL layer for a decorative shader.
 *
 * - Colors come from the theme: each entry of `colors` is a CSS expression
 *   ("var(--background)"), resolved through a 2D canvas so oklch and
 *   color-mix work, and read again whenever the palette changes. They reach
 *   the shader as `uniform vec3 u_<name>`.
 * - Every shader gets `u_res` (device pixels), `u_time` (seconds), `u_dpr`,
 *   and with `interactive`, `u_pointer` (0..1, origin bottom-left, eased) and
 *   `u_hover` (0..1, eased in while the pointer is over the host).
 * - Full motion animates; Reduced and Off draw one frame and stop. Offscreen
 *   or in a hidden tab, nothing is drawn.
 * - Without WebGL the layer stays empty and whatever sits under it (a CSS
 *   gradient, the page) shows instead.
 *
 * The pointer is read from the parent element, so content above the canvas
 * stays clickable; the canvas itself ignores the pointer.
 */
export function ShaderCanvas({
  fragment,
  colors,
  interactive = false,
  className,
  maxDpr = 1.5,
}: {
  /** A WebGL 1 fragment shader body. Standard derivatives are enabled. */
  fragment: string;
  colors: Record<string, string>;
  interactive?: boolean;
  className?: string;
  /** Caps the resolution, since decorative shaders do not need full retina. */
  maxDpr?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  const { animates } = useMotion();
  const colorKey = JSON.stringify(colors);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, alpha: true });
    // Never lose the context on cleanup: a canvas hands back the same context object on the next getContext, so a lost one would stay dead through Strict Mode's double mount and every theme switch.
    if (!gl || gl.isContextLost()) return;
    const derivatives = gl.getExtension("OES_standard_derivatives");

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn("[ShaderCanvas]", gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const header = `${derivatives ? "#extension GL_OES_standard_derivatives : enable\n#define HAS_DERIVATIVES 1\n" : ""}precision highp float;\n`;
    const vs = compile(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}");
    const fs = compile(gl.FRAGMENT_SHADER, header + fragment);
    if (!vs || !fs) return;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    // One triangle that covers the viewport.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("u_res");
    const uTime = u("u_time");
    const uDpr = u("u_dpr");
    const uPointer = u("u_pointer");
    const uHover = u("u_hover");

    // Theme colors, resolved to 0..1 RGB.
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    probe.canvas.width = probe.canvas.height = 1;
    const readColor = (expression: string): [number, number, number] => {
      const style = getComputedStyle(host);
      const value = expression.replace(/var\((--[\w-]+)\)/g, (_, v: string) => style.getPropertyValue(v).trim() || "#000");
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "#000";
      probe.fillStyle = value;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      return [r / 255, g / 255, b / 255];
    };
    const entries = Object.entries(JSON.parse(colorKey) as Record<string, string>);
    const applyColors = () => {
      for (const [name, expression] of entries) {
        const [r, g, b] = readColor(expression);
        gl.uniform3f(u(`u_${name}`), r, g, b);
      }
    };

    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const { width, height } = host.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const start = performance.now();
    let frame = 0;
    let running = false;
    let visible = true;

    // Pointer, eased toward its target every frame.
    const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, hover: 0, thover: 0 };
    const draw = (now: number) => {
      const ease = animates ? 0.08 : 1;
      pointer.x += (pointer.tx - pointer.x) * ease;
      pointer.y += (pointer.ty - pointer.y) * ease;
      pointer.hover += (pointer.thover - pointer.hover) * (animates ? 0.05 : 1);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, animates ? (now - start) / 1000 : 12.0);
      gl.uniform1f(uDpr, dpr);
      gl.uniform2f(uPointer, pointer.x, pointer.y);
      gl.uniform1f(uHover, pointer.hover);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    const sync = () => {
      const shouldRun = animates && visible && document.visibilityState === "visible";
      if (shouldRun && !running) {
        running = true;
        frame = requestAnimationFrame(loop);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(frame);
      }
      if (!running) draw(performance.now());
    };

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.tx = (e.clientX - r.left) / r.width;
      pointer.ty = 1 - (e.clientY - r.top) / r.height;
      pointer.thover = 1;
      if (!running) draw(performance.now());
    };
    const onLeave = () => {
      pointer.thover = 0;
    };
    if (interactive) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
    }

    resize();
    applyColors();
    sync();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (!running) draw(performance.now());
    });
    resizeObserver.observe(host);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    intersection.observe(host);
    // The palette is switched on <html>; read the colors again when it is.
    const palette = new MutationObserver(() => {
      applyColors();
      if (!running) draw(performance.now());
    });
    palette.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-mode", "style"] });
    document.addEventListener("visibilitychange", sync);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      palette.disconnect();
      document.removeEventListener("visibilitychange", sync);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [fragment, colorKey, interactive, animates, resolvedTheme, maxDpr]);

  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none absolute inset-0 block size-full", className)} />;
}

/** Value noise and fractal noise, shared by the shaders. */
export const NOISE_GLSL = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), w.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), w.x), w.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; } return v; }
`;
