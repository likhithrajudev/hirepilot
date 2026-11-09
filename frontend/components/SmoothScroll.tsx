"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/** Inertial page scrolling (Lenis). Skipped for reduced-motion users; modals/inner scrollers opt out with data-lenis-prevent. */
export default function SmoothScroll({ enabled = true }: { enabled?: boolean }) {
  useEffect(() => {
    if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.95, touchMultiplier: 1.4, smoothWheel: true });
    let raf = 0;
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const stop = () => lenis.stop(), start = () => lenis.start();
    window.addEventListener("hp:scroll-lock", stop);
    window.addEventListener("hp:scroll-unlock", start);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hp:scroll-lock", stop);
      window.removeEventListener("hp:scroll-unlock", start);
      lenis.destroy();
    };
  }, [enabled]);
  return null;
}
