"use client";

import { useEffect, useRef } from "react";
import type { Presence } from "./VoiceWave";

/* Small pieces of the live room: the voice bars, the mic meter and the word-by-word caption. Palette follows the room design:
   purple for the interviewer, green for you, pink while it thinks. */
export const ROOM = { bg: "#0A0A0A", surface: "#141414", surface2: "#1F1F1F", line: "#2B2B2B", muted: "#A3A3A3", accent: "#8A75FF", pink: "#FF8AE6", green: "#3DDC84", orange: "#FF5A00", bad: "#FF5C6C" } as const;

const N = 48;

/** 48 bars that follow the voice: purple while the interviewer speaks, green while you do, a slow pink pulse while it thinks. */
export function RoomWave({ state, output, input }: { state: Presence; output: React.RefObject<number>; input: React.RefObject<number> }) {
  const bars = useRef<HTMLSpanElement[]>([]);
  const mode = useRef(state); mode.current = state;
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, t = 0, energy = 0;
    const loop = () => {
      t += 1;
      const m = mode.current;
      const level = m === "speaking" ? output.current ?? 0 : m === "listening" ? input.current ?? 0 : 0;
      energy += (Math.min(1, level * 1.6) - energy) * 0.25;
      for (let i = 0; i < N; i++) {
        const b = bars.current[i];
        if (!b) continue;
        const env = Math.sin((i / (N - 1)) * Math.PI);
        let h = 6, col: string = ROOM.line;
        if (m === "speaking" || m === "listening") {
          const a = Math.abs(Math.sin(t * 0.12 + i * 0.47) * Math.cos(t * 0.05 + i * 0.19));
          h = Math.round(8 + env * (8 + (0.35 + a * 0.65) * energy * 104));
          col = m === "speaking" ? ROOM.accent : ROOM.green;
        } else if (m === "thinking" && !still) {
          h = Math.round(6 + env * 10 * (1 + Math.sin(t * 0.08 + i * 0.3)));
          col = "rgba(255,138,230,.7)";
        }
        b.style.height = `${h}px`; b.style.backgroundColor = col;
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [input, output]);
  return (
    <div aria-hidden="true" className="flex h-[clamp(72px,14vh,120px)] shrink-0 items-center justify-center gap-[5px]">
      {Array.from({ length: N }, (_, i) => <span key={i} ref={(el) => { if (el) bars.current[i] = el; }} className="w-[6px] rounded-[3px]" style={{ height: 6, backgroundColor: ROOM.line, transition: "height .15s ease, background-color .3s ease" }} />)}
    </div>
  );
}

/** Ten small bars that rise with your voice. */
export function MicBars({ level, active }: { level: React.RefObject<number>; active: boolean }) {
  const bars = useRef<HTMLSpanElement[]>([]);
  useEffect(() => {
    let raf = 0, t = 0;
    const loop = () => {
      t += 1;
      const l = active ? Math.min(1, (level.current ?? 0) * 1.4) : 0;
      bars.current.forEach((b, i) => {
        if (!b) return;
        const on = l > 0.06;
        b.style.height = `${on ? Math.round(4 + Math.abs(Math.sin(t * 0.3 + i * 0.8)) * 12 * l + l * 2) : 3}px`;
        b.style.backgroundColor = on ? ROOM.green : ROOM.line;
      });
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [level, active]);
  return <span aria-hidden="true" className="flex h-4 items-end gap-[2px]">{Array.from({ length: 10 }, (_, i) => <span key={i} ref={(el) => { if (el) bars.current[i] = el; }} className="w-1 rounded-[1px]" style={{ height: 3, backgroundColor: ROOM.line, transition: "height .1s ease" }} />)}</span>;
}

/** The interviewer's line. With `shown`, the words already heard are solid, the word being spoken is highlighted and the rest are faint; the whole
 *  line is laid out up front so nothing reflows. Without it, words fade in as they arrive. */
export function Caption({ text, shown }: { text: string; shown?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((w, i) => {
        if (shown === undefined) return <span key={i} className="word-in mr-[.26em] inline-block">{w}</span>;
        const current = i === shown - 1 && shown < words.length, future = i >= shown;
        return <span key={i} className={`mr-[.26em] inline-block rounded-md transition-[color,opacity] duration-150 ${future ? "opacity-[.22]" : ""} ${current ? "bg-[#8A75FF] text-[#0A0A0A] shadow-[0_0_0_3px_#8A75FF]" : ""}`}>{w}</span>;
      })}
    </>
  );
}

/** Your own words as they are recognised: the last few are dimmer and italic because they may still change. */
export function LiveWords({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  return <>{words.map((w, i) => <span key={i} className={`mr-[.26em] inline-block ${i >= words.length - 3 ? "italic text-[#A3A3A3]" : ""}`}>{w}</span>)}</>;
}
