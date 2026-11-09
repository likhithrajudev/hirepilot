"use client";

import { AlertTriangle, CheckCircle2, Loader2, Sparkles, TriangleAlert, Wand2, X } from "lucide-react";
import { useEffect } from "react";
import { useDeleteTask, useJob, useStartTask, useTask, useTasks } from "@/lib/hooks";
import type { TailorResult } from "@/lib/types";
import { useState } from "react";
import { timeAgo } from "./ui";

export interface TailorMeta {
  company: string;
  job_title: string;
  job_description: string;
  job_id?: number;
}
export interface JobForm { company: string; title: string; jd: string }

export default function TailorPanel({
  resumeId, latex, jobId, onReview, form, setForm, reviewingTaskId,
}: {
  resumeId: number;
  latex: string;
  jobId: number | null;
  onReview: (r: TailorResult, meta: TailorMeta, taskId: string) => void;
  form: JobForm;
  setForm: (f: JobForm) => void;
  reviewingTaskId: string | null;
}) {
  const { company, title, jd } = form;
  const [extra, setExtra] = useState("");
  const job = useJob(jobId);
  const tasks = useTasks({ resume_id: resumeId, kind: "tailor", limit: 3 });
  const start = useStartTask();
  const del = useDeleteTask();
  const latest = tasks.data?.[0];
  const active = latest && (latest.status === "queued" || latest.status === "running");
  const done = latest?.status === "done" && latest.id !== reviewingTaskId ? latest : undefined;
  const full = useTask<TailorResult>(done?.id ?? null);
  const result = full.data?.result ?? null;

  // Prefill from a job picked on the Jobs page (?job=ID).
  useEffect(() => {
    if (job.data) setForm({ company: job.data.company, title: job.data.title, jd: job.data.description });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data]);

  const run = () =>
    start.mutate({
      kind: "tailor", resume_id: resumeId,
      payload: { job_description: jd, company: company || undefined, job_title: title || undefined, job_id: jobId ?? undefined, instructions: extra || undefined, latex },
    });

  const meta = (): TailorMeta => ({
    company: String(full.data && (full.data as any).payload?.company || company || ""),
    job_title: String(full.data && (full.data as any).payload?.job_title || title || ""),
    job_description: String(full.data && (full.data as any).payload?.job_description || jd || ""),
    job_id: (full.data as any)?.payload?.job_id ?? jobId ?? undefined,
  });

  return (
    <div className="space-y-4 p-4">
      {jobId && (
        <div className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand">
          {job.isLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          {job.isLoading ? "Loading job posting…" : "Prefilled from the job you picked"}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="label" htmlFor="tp-co">Company</label>
          <input id="tp-co" className="input" value={company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Stripe" />
        </div>
        <div>
          <label className="label" htmlFor="tp-role">Role</label>
          <input id="tp-role" className="input" value={title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Backend Engineer" />
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="label !mb-0" htmlFor="tp-jd">Job description</label>
          <span className="text-[11px] tabular-nums text-subtle">{jd.length.toLocaleString()} chars</span>
        </div>
        <textarea id="tp-jd" className="input h-48 resize-y font-mono text-xs" value={jd} onChange={(e) => setForm({ ...form, jd: e.target.value })} placeholder="Paste the job description here…" />
      </div>
      <div>
        <label className="label" htmlFor="tp-x">Extra instructions <span className="normal-case tracking-normal text-subtle">(optional)</span></label>
        <input id="tp-x" className="input" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. lead with my backend projects" />
      </div>

      <button className="btn btn-primary !h-10 w-full" disabled={!!active || start.isPending || !jd.trim()} onClick={run}>
        {active || start.isPending ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
        {active ? "Tailoring in the background…" : "Tailor resume with AI"}
      </button>
      {start.isError && <p className="flex gap-2 rounded-lg border border-bad/25 bg-bad-soft p-3 text-[13px] text-bad"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{start.error.message}</p>}

      {active && latest && (
        <div className="pop space-y-3 rounded-xl border border-brand/25 bg-brand-soft/50 p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[13px] font-medium text-brand"><Loader2 size={14} className="animate-spin" />{latest.progress || "Queued"}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => del.mutate(latest.id)}><X size={12} /> Cancel</button>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface"><div className="skeleton h-full w-full" /></div>
          <p className="text-xs leading-relaxed text-muted">It keeps running if you switch tabs or leave this page. We&apos;ll notify you the moment it&apos;s ready. It edits only the resume body and checks the result before showing it.</p>
        </div>
      )}

      {latest?.status === "error" && (
        <div className="space-y-2 rounded-xl border border-bad/25 bg-bad-soft p-4 text-[13px] text-bad">
          <p className="flex gap-2"><TriangleAlert size={15} className="mt-0.5 shrink-0" />{latest.error}</p>
          <div className="flex gap-2"><button className="btn btn-sm" onClick={run} disabled={!jd.trim()}>Try again</button><button className="btn btn-sm btn-ghost" onClick={() => del.mutate(latest.id)}>Dismiss</button></div>
        </div>
      )}

      {done && result && (
        <div className="pop space-y-3 rounded-xl border border-brand/25 bg-brand-soft/60 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-brand"><Sparkles size={14} /> Ready to review</span>
            <span className="flex items-center gap-2">
              {result.estimated_fit !== null && <span className="chip bg-surface text-brand ring-1 ring-brand/20">Fit {result.estimated_fit}%</span>}
              <span className="text-[11px] text-subtle">{timeAgo(done.finished_at ?? done.created_at)}</span>
            </span>
          </div>
          {result.warnings && result.warnings.length > 0 && (
            <ul className="space-y-1.5 rounded-lg border border-warn/30 bg-warn-soft p-2.5 text-xs text-warn">
              {result.warnings.map((w, i) => <li key={i} className="flex gap-2"><TriangleAlert size={13} className="mt-px shrink-0" />{w}</li>)}
            </ul>
          )}
          <ul className="space-y-1.5">
            {result.changes.map((c, i) => <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-fg/90"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" />{c}</li>)}
            {result.changes.length === 0 && <li className="text-[13px] text-muted">No changes were made.</li>}
          </ul>
          {result.matched_keywords.length > 0 && <Chips label="Emphasised" items={result.matched_keywords} cls="bg-ok-soft text-ok" />}
          {result.missing_keywords.length > 0 && <Chips label="In the JD, not in your resume (not added)" items={result.missing_keywords} cls="bg-warn-soft text-warn" />}
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-subtle">
            {result.compile_ok === true && <span className="flex items-center gap-1 text-ok"><CheckCircle2 size={12} /> Compiles</span>}
            {result.pages ? <span>{result.pages} page{result.pages > 1 ? "s" : ""}</span> : null}
            {result.attempts && result.attempts > 1 ? <span>{result.attempts} attempts (auto-corrected)</span> : null}
            <span>Preamble untouched</span>
          </p>
          <div className="flex gap-2 pt-1">
            <button className="btn btn-primary flex-1" disabled={result.changes.length === 0} onClick={() => onReview(result, meta(), done.id)}>Review changes</button>
            <button className="btn" onClick={() => del.mutate(done.id)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Chips({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium text-muted">{label}</div>
      <div className="flex flex-wrap gap-1.5">{items.map((k) => <span key={k} className={`chip ${cls}`}>{k}</span>)}</div>
    </div>
  );
}
