"use client";

import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleAlert, Eye, Loader2, ScanSearch, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";
import { useDeleteTask, useStartTask, useTask, useTasks } from "@/lib/hooks";
import type { AtsReport } from "@/lib/types";
import { CopyButton } from "./ApplyDialog";
import type { JobForm } from "./TailorPanel";
import { ErrorNote } from "./ui";

const tone = (n: number) => (n >= 75 ? "var(--ok)" : n >= 55 ? "var(--warn)" : "var(--bad)");
const VERDICT = { strong: "Likely to pass", good: "Good chance", borderline: "Borderline", weak: "Likely filtered out" };

function BigScore({ n }: { n: number }) {
  const r = 46, c = 2 * Math.PI * r;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 110 110" className="-rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
        <motion.circle cx="55" cy="55" r={r} fill="none" stroke={tone(n)} strokeWidth="8" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - n / 100) }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-semibold tabular-nums leading-none">{n}</div><div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-subtle">ATS score</div></div></div>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line pt-3">
      <button className="flex w-full items-center justify-between text-left text-[13px] font-semibold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {title}<ChevronDown size={14} className={`text-subtle transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pt-3">{children}</div>}
    </div>
  );
}

function Report({ r }: { r: AtsReport }) {
  const sev = { high: "bg-bad-soft text-bad", medium: "bg-warn-soft text-warn", low: "bg-surface2 text-muted" };
  const Icon = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle };
  const col = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <BigScore n={r.overall} />
        <div className="min-w-0">
          <span className="chip text-[11px]" style={{ background: `color-mix(in srgb, ${tone(r.overall)} 14%, transparent)`, color: tone(r.overall) }}>{VERDICT[r.verdict]}</span>
          {r.recruiter_skim && <p className="mt-2 text-[13px] leading-relaxed text-muted">{r.recruiter_skim}</p>}
        </div>
      </div>

      <div className="space-y-2.5">
        {r.dimensions.map((d, i) => (
          <div key={d.key}>
            <div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium">{d.label}</span><span className="tabular-nums text-muted">{d.score}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
              <motion.div className="h-full rounded-full" style={{ background: tone(d.score) }} initial={{ width: 0 }} animate={{ width: `${d.score}%` }} transition={{ duration: 0.8, delay: 0.1 + i * 0.07, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            {d.note && <p className="mt-1 text-[11px] leading-snug text-subtle">{d.note}</p>}
          </div>
        ))}
      </div>

      {r.knockouts.length > 0 && (
        <Section title="Knockout risks">
          <ul className="space-y-2">{r.knockouts.map((k, i) => (
            <li key={i} className="rounded-lg border border-line p-2.5 text-[13px]"><div className="flex items-start gap-2"><ShieldAlert size={14} className="mt-0.5 shrink-0 text-bad" /><div><span className={`chip mr-1.5 ${sev[k.severity]}`}>{k.severity}</span>{k.issue}<p className="mt-1 text-xs text-muted">{k.fix}</p></div></div></li>
          ))}</ul>
        </Section>
      )}

      <Section title={`Must-have skills · ${r.must_have.filter((i) => i.found).length}/${r.must_have.length}`}>
        <div className="flex flex-wrap gap-1.5">{r.must_have.map((i) => (
          <span key={i.term} title={i.found ? i.evidence : "Not found in your resume text"} className={`chip ${i.found ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{i.found ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {i.term}</span>
        ))}</div>
      </Section>
      {r.nice_to_have.length > 0 && (
        <Section title={`Nice-to-have · ${r.nice_to_have.filter((i) => i.found).length}/${r.nice_to_have.length}`} defaultOpen={false}>
          <div className="flex flex-wrap gap-1.5">{r.nice_to_have.map((i) => <span key={i.term} className={`chip ${i.found ? "bg-ok-soft text-ok" : "bg-surface2 text-muted"}`}>{i.term}</span>)}</div>
        </Section>
      )}

      {r.top_fixes.length > 0 && (
        <Section title="Top fixes">
          <ol className="space-y-2">{r.top_fixes.map((f, i) => <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">{i + 1}</span>{f}</li>)}</ol>
        </Section>
      )}

      {r.bullet_feedback.length > 0 && (
        <Section title="Bullet rewrites" defaultOpen={false}>
          <div className="space-y-3">{r.bullet_feedback.map((b, i) => (
            <div key={i} className="rounded-lg border border-line p-3 text-[13px]">
              <p className="text-muted line-through decoration-line2">{b.original}</p>
              <p className="mt-2 font-medium">{b.suggestion}</p>
              <div className="mt-1.5 flex items-center justify-between"><span className="text-xs text-subtle">{b.why}</span><CopyButton text={b.suggestion} /></div>
            </div>
          ))}</div>
        </Section>
      )}

      <Section title="Parseability checks" defaultOpen={r.parse_findings.some((f) => f.level !== "ok")}>
        <ul className="space-y-1.5">{r.parse_findings.map((f, i) => { const I = Icon[f.level]; return <li key={i} className="flex gap-2 text-[13px] leading-snug"><I size={14} className={`mt-0.5 shrink-0 ${col[f.level]}`} />{f.message}</li>; })}</ul>
      </Section>

      <Section title="What the ATS sees" defaultOpen={false}>
        <p className="mb-2 flex items-center gap-1.5 text-xs text-subtle"><Eye size={12} /> Plain text extracted from your compiled PDF{r.pages ? ` (${r.pages} page${r.pages > 1 ? "s" : ""})` : ""}. If it looks scrambled, an ATS will read it that way too.</p>
        <pre data-lenis-prevent className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface2 p-3 font-mono text-[11px] leading-relaxed text-muted">{r.ats_text || "(nothing extracted)"}</pre>
      </Section>
    </div>
  );
}

export default function AtsPanel({ resumeId, latex, form, setForm }: { resumeId: number; latex: string; form: JobForm; setForm: (f: JobForm) => void }) {
  const tasks = useTasks({ resume_id: resumeId, kind: "ats", limit: 3 });
  const start = useStartTask();
  const del = useDeleteTask();
  const latest = tasks.data?.[0];
  const active = latest && (latest.status === "queued" || latest.status === "running");
  const full = useTask<AtsReport>(latest?.status === "done" ? latest.id : null);
  const report = full.data?.result ?? null;
  const ready = form.jd.trim().length >= 20;
  return (
    <div className="space-y-4 p-4">
      <p className="text-[13px] leading-relaxed text-muted">
        Emulates how large-company screening reads your resume: machine parse, hard knockouts, must-have skills, then the recruiter skim. It is an emulation, not any one company&apos;s private system.
      </p>
      <div>
        <div className="mb-1.5 flex items-center justify-between"><label className="label !mb-0" htmlFor="ats-jd">Job description</label><span className="text-[11px] tabular-nums text-subtle">{form.jd.length.toLocaleString()} chars</span></div>
        <textarea id="ats-jd" className="input h-36 resize-y font-mono text-xs" value={form.jd} onChange={(e) => setForm({ ...form, jd: e.target.value })} placeholder="Paste the job description (shared with the Tailor tab)…" />
      </div>
      <button className="btn btn-primary !h-10 w-full" disabled={!ready || !!active || start.isPending} onClick={() => start.mutate({ kind: "ats", resume_id: resumeId, payload: { job_description: form.jd, company: form.company || undefined, job_title: form.title || undefined, latex } })}>
        {active || start.isPending ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />} {active ? "Screening in the background…" : report ? "Re-run ATS check" : "Run ATS check"}
      </button>
      {start.isError && <ErrorNote>{start.error.message}</ErrorNote>}
      {active && latest && <p className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand" aria-live="polite"><Loader2 size={12} className="animate-spin" />{latest.progress || "Queued"}. Safe to switch tabs.<button className="ml-auto underline" onClick={() => del.mutate(latest.id)}>Cancel</button></p>}
      {latest?.status === "error" && <ErrorNote>{latest.error}</ErrorNote>}
      {report && !active && <Report r={report} />}
      {!report && !active && latest?.status !== "error" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line2 p-4 text-xs text-muted"><CircleAlert size={14} className="mt-0.5 shrink-0 text-subtle" />Run it on your master to see gaps, then again after tailoring to confirm the score improved.</div>
      )}
    </div>
  );
}
