"use client";

import { useEffect, useRef } from "react";

export type Presence = "idle" | "speaking" | "listening" | "thinking";

/** Perspective point field; speech energy changes the height of the surface. */
export function VoiceWave({ state, output, input }: { state: Presence; output: React.RefObject<number>; input: React.RefObject<number> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mode = useRef(state); mode.current = state;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1, height = 1, raf = 0, last = 0, phase = 0, energy = 0;
    const resize = () => {
      width = el.clientWidth; height = el.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      el.width = Math.round(width * ratio); el.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const draw = (now: number) => {
      if (now - last >= 33) {
        const dt = Math.min(.1, (now - last) / 1000); last = now;
        const reduced = media.matches || document.documentElement.dataset.motion === "reduce";
        const target = mode.current === "speaking" ? output.current : mode.current === "listening" ? input.current : 0;
        energy += (Math.min(1, Math.max(0, (target ?? 0) * 1.5)) - energy) * .22;
        if (!reduced) phase += dt * (.35 + energy * 3.4);
        ctx.clearRect(0, 0, width, height);
        const rows = width < 700 ? 25 : 36, columns = width < 700 ? 58 : 88;
        const point = (column: number, row: number) => {
          const x = column / columns * 2 - 1, z = row / rows;
          const ripple = Math.sin(x * 9 + z * 13 - phase * 2) * .5 + Math.cos(x * 17 - z * 7 + phase) * .3;
          const amplitude = reduced ? 0 : .03 + energy * .2;
          return [width / 2 + x * width * (.53 + z * .25), height * (.2 + z * z * .78 + x * x * .4 - ripple * amplitude * (1 - z * .4))];
        };
        ctx.lineWidth = .65;
        for (let row = 0; row <= rows; row++) {
          ctx.beginPath();
          for (let col = 0; col <= columns; col++) { const [x, y] = point(col, row); if (col === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
          ctx.strokeStyle = `rgba(103,175,255,${.12 + (1 - row / rows) * .27})`; ctx.stroke();
        }
        for (let col = 0; col <= columns; col++) {
          ctx.beginPath();
          for (let row = 0; row <= rows; row++) { const [x, y] = point(col, row); if (row === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
          ctx.strokeStyle = "rgba(91,160,246,.16)"; ctx.stroke();
          for (let row = 0; row <= rows; row += 2) { const [x, y] = point(col, row); ctx.fillStyle = `rgba(150,200,255,${.2 + energy * .3})`; const sz = 1.5 + energy * .9; ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz); }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, [input, output]);
  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[clamp(140px,28vh,300px)] w-full [mask-image:linear-gradient(to_top,#000_35%,transparent)]" />;
}

export function VoiceGlyph() {
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <circle key={i} cx={3 + i % 3 * 6} cy={3 + Math.floor(i / 3) * 6} r="1.5" fill="currentColor" opacity={.35 + (i % 3) * .25} />)}</svg>;
}
