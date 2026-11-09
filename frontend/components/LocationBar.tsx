"use client";

import { AnimatePresence, motion } from "motion/react";
import { Globe2, LocateFixed, Loader2, MapPin, Plus, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/app/providers";
import { POPULAR_CITIES, useLocations } from "@/lib/location";

type Loc = ReturnType<typeof useLocations>;

export default function LocationBar({ loc }: { loc: Loc }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const unselected = POPULAR_CITIES.filter((c) => !loc.selected.some((s) => s.toLowerCase() === c.toLowerCase())).slice(0, 8);

  return (
    <section className="card space-y-3 p-4" aria-label="Search locations">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle"><MapPin size={13} /> Where</span>
        <AnimatePresence initial={false}>
          {loc.selected.map((c) => (
            <motion.button
              key={c} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              onClick={() => loc.toggle(c)} aria-label={`Remove ${c}`}
              className="chip press cursor-pointer bg-brand-soft !px-3 !py-1.5 text-[12px] text-brand hover:brightness-95"
            >
              {c.toLowerCase() === loc.detected?.toLowerCase() && <LocateFixed size={11} />} {c} <X size={11} />
            </motion.button>
          ))}
        </AnimatePresence>
        {loc.selected.length === 0 && <span className="chip bg-surface2 !px-3 !py-1.5 text-muted"><Globe2 size={11} /> Anywhere</span>}

        <form className="ml-1 flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); loc.add(text); setText(""); }}>
          <input className="input !h-8 !w-36 text-xs" list="cities" placeholder="Add a city…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Add a city" />
          <datalist id="cities">{POPULAR_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
          <button className="btn btn-sm btn-icon !h-8" aria-label="Add city" disabled={!text.trim()}><Plus size={14} /></button>
        </form>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="btn btn-sm" disabled={loc.detecting}
            onClick={async () => { const c = await loc.detect(); toast(c ? `Detected ${c}` : "Could not detect your location. Add a city instead.", c ? "success" : "info"); }}
          >
            {loc.detecting ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />} {loc.detected ? "Re-detect" : "Detect my city"}
          </button>
          {loc.selected.length > 0 && <button className="btn btn-sm btn-ghost" onClick={loc.clear}>Anywhere</button>}
        </div>
      </div>
      {unselected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-subtle">Popular:</span>
          {["Remote", ...unselected].filter((c) => !loc.selected.includes(c)).map((c) => (
            <button key={c} onClick={() => loc.toggle(c)} className="chip press cursor-pointer bg-surface2 text-muted transition hover:text-fg">+ {c}</button>
          ))}
        </div>
      )}
    </section>
  );
}
