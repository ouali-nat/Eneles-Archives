"use client";

import { useEffect, useRef } from "react";
import { useMotion } from "@/hooks/useMotion";
import { cn } from "@/lib/utils";

/**
 * A field of monospace characters on a 2D canvas: a grid of cells whose glyph follows a slowly moving wave field, from a sparse dot to a dense mark, in the page's foreground color. The pointer brightens the cells around it.
 *
 * - Each glyph is drawn once into an atlas strip; a frame copies slots onto the grid instead of setting text per cell, so a full-screen field stays cheap.
 * - Full motion runs at 24 frames a second; Reduced and Off draw one still frame and ignore the pointer. A hidden tab or an offscreen field draws nothing.
 * - Colors are read from the theme and read again when it changes. Opacity is the caller's: wrap it in a layer at the strength you want.
 *
 * The canvas ignores the pointer, so whatever sits above it stays clickable.
 */
const GLYPHS = [" ", ".", "·", ":", "-", "=", "+", "*", "#", "%", "@"];
const FPS = 24;

export function AsciiField({ className, size = 13 }: { className?: string; /** Font size of a cell in CSS pixels; smaller is denser. */ size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { animates } = useMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !host || !context) return;

    const atlas = document.createElement("canvas");
    const atlasContext = atlas.getContext("2d")!;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let cellW = 1;
    let cellH = 1;
    let slotW = 1;
    let columns = 0;
    let rows = 0;
    let left = 0;
    let top = 0;
    let glow = new Float32Array(0);
    const pointer = { x: -1e4, y: -1e4, inside: false };

    const foreground = () => getComputedStyle(host).getPropertyValue("--foreground").trim() || "#888";
    const family = () => getComputedStyle(host).getPropertyValue("--font-jetbrains-mono").trim() || "ui-monospace, monospace";

    // Every glyph once, in rising strength, into whole-pixel slots.
    const paintAtlas = () => {
      const font = `${size * dpr}px ${family()}`;
      atlasContext.font = font;
      slotW = Math.ceil(cellW) + 2;
      atlas.width = slotW * GLYPHS.length;
      atlas.height = Math.ceil(cellH);
      atlasContext.font = font;
      atlasContext.textBaseline = "top";
      atlasContext.fillStyle = foreground();
      GLYPHS.forEach((glyph, level) => {
        if (!level) return;
        atlasContext.globalAlpha = 0.25 + 0.75 * (level / (GLYPHS.length - 1));
        atlasContext.fillText(glyph, level * slotW + 1, cellH * 0.1);
      });
      atlasContext.globalAlpha = 1;
    };

    const layout = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = host.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      context.font = `${size * dpr}px ${family()}`;
      cellW = Math.max(1, context.measureText("M").width);
      cellH = size * dpr * 1.25;
      columns = Math.ceil(width / cellW);
      rows = Math.ceil(height / cellH);
      left = (width - columns * cellW) / 2;
      top = (height - rows * cellH) / 2;
      glow = new Float32Array(columns * rows);
      paintAtlas();
    };

    const start = performance.now();
    const draw = (now: number, live: boolean) => {
      const t = live ? (now - start) / 1000 : 8;
      context.clearRect(0, 0, width, height);
      const px = (pointer.x * dpr - left) / cellW;
      const py = (pointer.y * dpr - top) / cellH;
      const reach = 14;
      const densest = GLYPHS.length - 1;
      for (let row = 0; row < rows; row++) {
        const y = Math.round(top + row * cellH);
        for (let column = 0; column < columns; column++) {
          const index = row * columns + column;
          // Cells are about twice as tall as wide, so rows count double to keep shapes round.
          const x = column;
          const yy = row * 2;
          let value =
            0.42 +
            0.2 * Math.sin(x * 0.11 + t * 0.7) +
            0.17 * Math.sin(yy * 0.08 - t * 0.5 + Math.sin(x * 0.045 + t * 0.25) * 2) +
            0.13 * Math.sin((x + yy) * 0.055 - t * 0.35);
          let target = 0;
          if (live && pointer.inside) {
            const d = Math.hypot(x - px, yy - py * 2);
            if (d < reach * 2) target = (1 - d / (reach * 2)) ** 2;
          }
          glow[index] += (target - glow[index]) * (live ? 0.18 : 1);
          value = Math.min(1, Math.max(0, value * value * 1.05 + glow[index] * 0.8));
          const level = Math.round(value * densest);
          if (!level) continue;
          context.drawImage(atlas, level * slotW, 0, slotW, atlas.height, Math.round(left + column * cellW) - 1, y, slotW, atlas.height);
        }
      }
    };

    let raf = 0;
    let last = 0;
    let visible = true;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS) return;
      last = now;
      draw(now, true);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      if (animates && visible && document.visibilityState === "visible") raf = requestAnimationFrame(loop);
      else draw(performance.now(), false);
    };

    const onMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
    };
    const onLeave = () => {
      pointer.inside = false;
    };
    // The field usually sits behind content, so the pointer is read from the window.
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    layout();
    sync();
    const resize = new ResizeObserver(() => {
      layout();
      if (!animates) draw(performance.now(), false);
    });
    resize.observe(host);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    intersection.observe(host);
    // The theme is switched on <html>; repaint the glyphs in the new color.
    const theme = new MutationObserver(() => {
      paintAtlas();
      if (!animates) draw(performance.now(), false);
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-mode", "style"] });
    document.addEventListener("visibilitychange", sync);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      intersection.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [animates, size]);

  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none absolute inset-0 block size-full", className)} />;
}
