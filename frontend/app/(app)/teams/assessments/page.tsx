"use client";

import { ClipboardList, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { Avatar, Stat } from "@/components/teams/parts";
import { useAssessmentResults, useAssessments } from "@/lib/teams";

const STATUS = { "Above cut-off": "bg-ok-soft text-ok", "Below cut-off": "bg-bad-soft text-bad", "In progress": "bg-warn-soft text-warn" } as const;
const mmss = (s: number | null) => (s === null ? "–" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export default function AssessmentResults() {
  const list = useAssessments();
  const [sel, setSel] = useState(0);
  useEffect(() => { try { const v = Number(localStorage.getItem("hp_team_assessment")); if (v) setSel(v); } catch {} }, []);
  const id = list.data?.find((a) => a.id === sel)?.id ?? list.data?.[0]?.id ?? 0;
  useEffect(() => { try { if (id) localStorage.setItem("hp_team_assessment", String(id)); } catch {} }, [id]);
  const res = useAssessmentResults(id);
  if (list.isLoading) return <Skeleton className="h-64" />;
  if (list.error) return <ErrorNote>Could not load assessments.</ErrorNote>;
  if (!list.data?.length) return <EmptyState icon={<ClipboardList size={22} />} title="No assessments yet" body="Build a timed test from multiple-choice questions and coding problems, attach it to a role, and see everyone's results here." action={<Link href="/teams/assessments/new" className="btn btn-primary">New assessment</Link>} />;
  const r = res.data;
  const max = Math.max(1, ...(r?.histogram ?? [1]));
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Hiring · Assessments" title={r?.assessment.title ?? "Assessment"} subtitle={<span className="inline-flex flex-wrap items-center gap-2">{r ? `${r.assessment.questions} questions · ${r.assessment.duration_min} min · cut-off ${r.assessment.cutoff}%` : ""}<select className="input !h-8 !w-auto !py-0 text-xs" aria-label="Assessment" value={id} onChange={(e) => setSel(Number(e.target.value))}>{list.data.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select></span>}
        actions={<><Link href={`/teams/assessments/new?id=${id}`} className="btn"><Pencil size={14} /> Edit questions</Link><Link href="/teams/assessments/new" className="btn btn-primary"><Plus size={14} /> New assessment</Link></>} />
      <p className="text-xs text-muted">Attach an assessment to a role from the pipeline. Candidates take it from their invite link.</p>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Assessment summary"><Stat label="Invited" value={r?.summary.invited ?? "–"} /><Stat label="Completed" value={r?.summary.completed ?? "–"} note={r && r.summary.started ? `of ${r.summary.started} started` : undefined} /><Stat label="Median score" value={r?.summary.median != null ? `${r.summary.median}%` : "–"} /><Stat label="Above cut-off" value={r?.summary.above_cutoff ?? "–"} /></section>
      {res.isLoading ? <Skeleton className="h-48" /> : r && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="card portal-table" aria-label="Candidates"><div className="p-5"><h2 className="text-base font-semibold">Candidates</h2></div>
            {!r.rows.length ? <p className="px-5 pb-5 text-sm text-muted">Nobody has started yet.</p> : <table><caption className="sr-only">Assessment results</caption><thead><tr><th scope="col">Candidate</th><th scope="col">Score</th><th scope="col">Time</th><th scope="col">Status</th></tr></thead>
              <tbody>{r.rows.map((x, i) => <tr key={x.candidate_id}><td><Link href={`/teams/candidates/${x.candidate_id}`} className="flex items-center gap-2.5 hover:text-brand"><Avatar name={x.name} i={i} size={30} /><span><span className="block font-semibold">{x.name}</span><span className="block text-xs text-muted">{x.school}</span></span></Link></td>
                <td>{x.score === null ? <span className="text-muted">–</span> : <div className="flex items-center gap-2.5"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface2" aria-hidden="true"><div className={`h-full rounded-full ${x.score >= r.assessment.cutoff ? "bg-ok" : x.score >= 50 ? "bg-warn" : "bg-bad"}`} style={{ width: `${x.score}%` }} /></div><span className="tabular-nums font-semibold">{x.score}%</span></div>}</td>
                <td className="tabular-nums text-muted">{mmss(x.seconds)}</td><td><span className={`chip ${STATUS[x.status as keyof typeof STATUS]}`}>{x.status}</span></td></tr>)}</tbody></table>}</section>
          <aside className="space-y-4">
            <section className="card p-5"><h2 className="text-sm font-semibold">Score distribution</h2><p className="text-xs text-muted">{r.summary.completed} completed</p>
              <div className="mt-4 flex h-28 items-end gap-1" role="img" aria-label="Histogram of scores">{r.histogram.map((c, i) => <div key={i} title={`${i * 10}–${i * 10 + 9}%: ${c}`} className={`flex-1 rounded-t ${i * 10 >= r.assessment.cutoff ? "bg-brand" : "bg-brand/30"}`} style={{ height: `${Math.max(c ? 6 : 0, Math.round((c / max) * 100))}%` }} />)}</div><div className="mt-1 flex justify-between text-[11px] text-muted"><span>0</span><span>50</span><span>100</span></div></section>
            <section className="card p-5"><h2 className="text-sm font-semibold">Hardest questions</h2>{!r.hardest.length ? <p className="mt-2 text-xs text-muted">Appears once someone finishes.</p> : <div className="mt-3 space-y-3">{r.hardest.map((h) => <div key={h.index}><div className="flex justify-between gap-3 text-xs"><span className="truncate">Q{h.index} · {h.label}</span><span className="shrink-0 tabular-nums text-muted">{h.percent}% earned</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-bad" style={{ width: `${h.percent}%` }} /></div></div>)}</div>}</section>
          </aside>
        </div>)}
    </div>
  );
}
