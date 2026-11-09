"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, ChevronDown, CircleHelp, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";
import type { ScoreDetail, Verdict } from "@/lib/types";

const V: Record<Verdict, { label: string; cls: string; q: string }> = {
  strong_yes: { label: "Strong yes", cls: "bg-ok-soft text-ok", q: "I'd fast-track this one." },
  yes: { label: "Yes, interview", cls: "bg-brand-soft text-brand", q: "Worth a screen." },
  maybe: { label: "Maybe", cls: "bg-warn-soft text-warn", q: "Depends on the gaps." },
  no: { label: "Pass", cls: "bg-bad-soft text-bad", q: "Not for this role." },
};
const DIM: [keyof ScoreDetail["dimensions"], string][] = [["technical_fit", "Technical fit"], ["impact", "Evidence of impact"], ["scope_fit", "Scope & ramp-up"], ["learning_agility", "Learning agility"]];
const tone = (n: number) => (n >= 75 ? "var(--ok)" : n >= 55 ? "var(--warn)" : "var(--bad)");

/** How an engineering manager would read this application: verdict first, reasoning one click away. */
export default function ManagerTake({ d }: { d: ScoreDetail }) {
  const [open, setOpen] = useState(false);
  const v = V[d.verdict] ?? V.maybe;
  return (
    <div className="mt-2.5 rounded-xl border border-line bg-surface2/60">
      <button className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`chip mt-0.5 shrink-0 !px-2.5 !py-1 text-[11.5px] ${v.cls}`}>{v.label}</span>
        <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted"><span className="font-medium text-fg">Hiring manager:</span> {d.summary || v.q}</span>
        <ChevronDown size={15} className={`mt-1 shrink-0 text-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="grid gap-5 border-t border-line p-4 sm:grid-cols-2">
              <div className="space-y-2.5">
                {DIM.map(([k, label], i) => (
                  <div key={k}>
                    <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{label}</span><span className="tabular-nums text-muted">{d.dimensions[k]}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface"><motion.div className="h-full rounded-full" style={{ background: tone(d.dimensions[k]) }} initial={{ width: 0 }} animate={{ width: `${d.dimensions[k]}%` }} transition={{ duration: 0.6, delay: i * 0.05 }} /></div>
                  </div>
                ))}
                {d.must_haves.length > 0 && (
                  <div className="pt-1">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Must-haves, checked against your resume</div>
                    <div className="flex flex-wrap gap-1.5">{d.must_haves.map((m) => <span key={m.term} title={m.met ? m.evidence : "No evidence in your resume text"} className={`chip ${m.met ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{m.met ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {m.term}</span>)}</div>
                  </div>
                )}
              </div>
              <div className="space-y-3 text-[13px]">
                {d.knockouts.length > 0 && <List title="Knockouts" icon={<ShieldAlert size={13} className="text-bad" />} items={d.knockouts.map((k) => `${k.issue}${k.fix ? ` (${k.fix})` : ""}`)} />}
                {d.strengths.length > 0 && <List title="What I like" icon={<CheckCircle2 size={13} className="text-ok" />} items={d.strengths} />}
                {d.gaps.length > 0 && <List title="What worries me" icon={<XCircle size={13} className="text-warn" />} items={d.gaps} />}
                {d.interview_focus.length > 0 && <List title="I'd probe in the screen" icon={<CircleHelp size={13} className="text-brand" />} items={d.interview_focus} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function List({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{icon}{title}</div>
      <ul className="space-y-1">{items.map((x, i) => <li key={i} className="leading-snug text-fg/90">{x}</li>)}</ul>
    </div>
  );
}
