"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, X } from "lucide-react";
import type { InterviewTurn } from "@/lib/types";
import { ROOM } from "./RoomParts";

const ms = (at?: string) => (at ? new Date(/Z|[+-]\d\d:?\d\d$/.test(at) ? at : at + "Z").getTime() : NaN);
const mmss = (t: number) => `${String(Math.floor(Math.max(0, t) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;
const wordsIn = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** The conversation as a feed: who spoke, when, what kind of turn it was and the words, newest at the bottom. */
export function LiveTranscript({ turns, name, initials, startedAt, live, partial, onClose }: { turns: InterviewTurn[]; name: string; initials: string; startedAt: string; live: string; partial: string; onClose: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const sticky = useRef(true);
  const [away, setAway] = useState(false);
  useEffect(() => { const el = viewport.current; if (el && sticky.current) el.scrollTop = el.scrollHeight; }, [turns, live, partial]);
  const start = ms(startedAt);
  const mine = turns.filter((t) => t.who === "candidate"), theirs = turns.filter((t) => t.who === "interviewer");
  const myWords = mine.reduce((n, t) => n + wordsIn(t.text), 0), allWords = myWords + theirs.reduce((n, t) => n + wordsIn(t.text), 0);
  const stats = [["YOU SPOKE", allWords ? `${Math.round((myWords / allWords) * 100)}%` : "0%"], ["YOUR WORDS", String(myWords)], ["ANSWERED", String(mine.filter((t) => !t.smalltalk).length)]];
  let q = 0;
  const tagFor = (t: InterviewTurn): { label: string; tone: "orange" | "accent" } | null => {
    if (t.who !== "interviewer") return null;
    if (t.kind === "question") { q += 1; return { label: `Q${q}`, tone: "orange" }; }
    if (t.kind === "followup") return { label: "Follow-up", tone: "accent" };
    if (t.kind === "wrapup") return { label: "Wrap-up", tone: "accent" };
    return null;
  };
  const item = (key: string | number, who: "interviewer" | "candidate", time: string, text: React.ReactNode, tag?: { label: string; tone: "orange" | "accent" } | null) => (
    <article key={key} className="grid grid-cols-[34px_1fr] gap-3">
      <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] text-[13px] font-bold text-[#0A0A0A]" style={{ background: who === "interviewer" ? ROOM.accent : ROOM.green }}>{who === "interviewer" ? name.slice(0, 1).toUpperCase() : initials}</span>
      <div className="min-w-0">
        <p className="mb-1 flex flex-wrap items-center gap-2 text-xs"><b className="text-[13px]">{who === "interviewer" ? name : "You"}</b><span className="font-mono text-[#A3A3A3]">{time}</span>
          {tag && <span className="rounded px-[7px] py-px font-semibold" style={{ color: tag.tone === "orange" ? ROOM.orange : ROOM.accent, background: `color-mix(in srgb, ${tag.tone === "orange" ? ROOM.orange : ROOM.accent} 18%, transparent)` }}>{tag.label}</span>}</p>
        <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.55] [overflow-wrap:anywhere]">{text}</p>
      </div>
    </article>
  );
  return (
    <section aria-label="Live transcript" className="relative flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#2B2B2B] px-5 py-4">
        <h2 className="text-[15px] font-bold">Live transcript</h2>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[.08em]" style={{ color: live || partial ? ROOM.green : ROOM.muted }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: live || partial ? ROOM.green : ROOM.muted, animation: live || partial ? "hp-blink 1.2s steps(1) infinite" : undefined }} />{live || partial ? "STREAMING" : "LIVE"}</span>
          <button aria-label="Hide transcript" onClick={onClose} className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"><X size={14} /></button>
        </div>
      </header>
      <dl className="grid shrink-0 grid-cols-3 border-b border-[#2B2B2B]">
        {stats.map(([k, v], i) => <div key={k} className={`px-5 py-3 ${i < 2 ? "border-r border-[#2B2B2B]" : ""}`}><dt className="font-mono text-[11px] text-[#A3A3A3]">{k}</dt><dd className="mt-0.5 text-[18px] font-bold">{v}</dd></div>)}
      </dl>
      <div ref={viewport} onScroll={(e) => { const el = e.currentTarget; sticky.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; setAway(!sticky.current); }} className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto overscroll-contain px-5 pb-5 pt-4" data-lenis-prevent>
        {turns.map((t, i) => item(i, t.who, Number.isFinite(ms(t.at)) && Number.isFinite(start) ? mmss((ms(t.at) - start) / 1000) : "", t.text, tagFor(t)))}
        {live && item("live", "interviewer", "", <span aria-live="polite">{live}</span>)}
        {partial && item("partial", "candidate", "", <span className="italic text-[#A3A3A3]">{partial}</span>)}
      </div>
      {away && <button className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-white/15 bg-[#1F1F1F] px-3 py-1.5 text-[10px] text-white shadow-lg" onClick={() => { sticky.current = true; setAway(false); viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown size={12} /> Latest</button>}
    </section>
  );
}
