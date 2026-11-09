"use client";

import { Copy, Link2, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/providers";
import { EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { Avatar, Stat, scoreTone } from "@/components/teams/parts";
import { api, ApiError, json } from "@/lib/api";
import { copy, fullUrl, useAssessments, usePipeline, useTeamJobs, type Card } from "@/lib/teams";

const STAGES: [string, string][] = [["applied", "Applied"], ["interview", "AI interview"], ["assessment", "Assessment"], ["panel", "Panel interview"], ["offer", "Offer"], ["rejected", "Rejected"]];
const DOT: Record<string, string> = { applied: "bg-muted", interview: "bg-brand", assessment: "bg-warn", panel: "bg-[#FF8AE6]", offer: "bg-ok" };
const REC = { advance: ["Advance", "bg-ok-soft text-ok"], hold: ["Hold", "bg-warn-soft text-warn"], reject: ["Review", "bg-bad-soft text-bad"] } as const;

export default function Pipeline() {
  const jobs = useTeamJobs();
  const qc = useQueryClient();
  const toast = useToast();
  const assessments = useAssessments();
  const [sel, setSel] = useState(0);
  const [rec, setRec] = useState(false);
  const [form, setForm] = useState<"" | "role" | "candidate">("");
  const [role, setRole] = useState({ title: "", location: "" });
  const [cand, setCand] = useState({ name: "", email: "", school: "" });
  const [made, setMade] = useState<Card | null>(null);
  useEffect(() => { try { const v = Number(localStorage.getItem("hp_team_job")); if (v) setSel(v); } catch {} }, []);
  const list = jobs.data ?? [];
  const jobId = list.find((j) => j.id === sel)?.id ?? list[0]?.id ?? 0;
  useEffect(() => { try { if (jobId) localStorage.setItem("hp_team_job", String(jobId)); } catch {} }, [jobId]);
  const pipe = usePipeline(jobId);
  const job = list.find((j) => j.id === jobId);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["teams"] }); };
  const fail = (e: unknown, fallback: string) => toast(e instanceof ApiError ? e.message : fallback, "error");

  const addRole = async () => { try { const r = await api<{ id: number }>("/teams/jobs", json(role)); setSel(r.id); setForm(""); setRole({ title: "", location: "" }); refresh(); } catch (e) { fail(e, "Could not create the role"); } };
  const invite = async () => { try { const c = await api<Card>(`/teams/jobs/${jobId}/candidates`, json(cand)); setMade(c); setCand({ name: "", email: "", school: "" }); setForm(""); refresh(); } catch (e) { fail(e, "Could not add the candidate"); } };
  const move = async (c: Card, stage: string) => { try { await api(`/teams/candidates/${c.id}/stage`, json({ stage })); refresh(); } catch (e) { fail(e, "Could not move the candidate"); } };
  const patch = async (body: object) => { try { await api(`/teams/jobs/${jobId}`, json(body, "PATCH")); refresh(); } catch (e) { fail(e, "Could not update the role"); } };

  const roleForm = (
    <section className="card space-y-3 p-5" aria-label="New role"><h2 className="font-semibold">New role</h2>
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><span className="label !mb-0">Title</span><input className="input" value={role.title} onChange={(e) => setRole({ ...role, title: e.target.value })} placeholder="Backend Engineer" /></label><label className="space-y-1"><span className="label !mb-0">Location</span><input className="input" value={role.location} onChange={(e) => setRole({ ...role, location: e.target.value })} placeholder="Bengaluru" /></label></div>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={role.title.trim().length < 2} onClick={() => void addRole()}>Create role</button>{list.length > 0 && <button className="btn btn-ghost" onClick={() => setForm("")}>Cancel</button>}</div></section>
  );

  if (jobs.isLoading) return <Skeleton className="h-64" />;
  if (jobs.error) return <ErrorNote>Could not load your roles. Refresh to try again.</ErrorNote>;
  if (!list.length) return <div className="space-y-5"><EmptyState icon={<Sparkles size={22} />} title="Set up your first role" body="Create a role, design the AI interviewer for it, then invite candidates with a link. Every candidate gets the same conversation." />{roleForm}</div>;

  const p = pipe.data;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Hiring · Pipeline" title={`${job?.title ?? "Role"} pipeline`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2 text-[13px]"><label className="inline-flex items-center gap-2">Role <select className="input !h-8 !w-auto !py-0 text-xs" value={jobId} onChange={(e) => setSel(Number(e.target.value))}>{list.map((j) => <option key={j.id} value={j.id}>{j.title}{j.location ? ` · ${j.location}` : ""}</option>)}</select></label><button className="btn btn-ghost btn-sm" onClick={() => setForm("role")}><Plus size={13} /> New role</button></span>}
        actions={<><Link href={`/teams/interviewer?job=${jobId}`} className="btn">{job?.published ? "Edit AI interviewer" : "Set up AI interviewer"}</Link><button className="btn btn-primary" onClick={() => setForm("candidate")} disabled={!job?.published} title={job?.published ? undefined : "Publish the AI interviewer first"}>Invite candidate</button></>} />
      {form === "role" && roleForm}
      {form === "candidate" && (
        <section className="card space-y-3 p-5" aria-label="Invite a candidate"><h2 className="font-semibold">Invite a candidate</h2>
          <div className="grid gap-3 sm:grid-cols-3">{(["name", "email", "school"] as const).map((k) => <label key={k} className="space-y-1"><span className="label !mb-0">{k === "school" ? "School or company (optional)" : k === "email" ? "Email (optional)" : "Name"}</span><input className="input" value={cand[k]} onChange={(e) => setCand({ ...cand, [k]: e.target.value })} /></label>)}</div>
          <p className="text-xs text-muted">This creates a private link. Nothing is emailed: you send the link yourself. The candidate signs in, is told what you will see, and then starts.</p>
          <div className="flex gap-2"><button className="btn btn-primary" disabled={!cand.name.trim()} onClick={() => void invite()}>Create invite link</button><button className="btn btn-ghost" onClick={() => setForm("")}>Cancel</button></div></section>)}
      {made && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-ok/30 bg-ok-soft p-4 text-[13px]" role="status"><Link2 size={16} className="text-ok" /><span className="min-w-0 flex-1"><b>Invite for {made.name}:</b> <code className="break-all">{fullUrl(made.invite_path)}</code></span>
          <button className="btn btn-sm" onClick={async () => toast((await copy(fullUrl(made.invite_path))) ? "Link copied" : "Copy the link by hand", "info")}><Copy size={13} /> Copy link</button><button className="btn btn-ghost btn-sm" onClick={() => setMade(null)}>Dismiss</button></section>)}
      {job && !job.published && <p role="note" className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-2.5 text-[13px] text-warn">The AI interviewer for this role is not published, so candidates cannot be invited yet. <Link className="font-semibold underline" href={`/teams/interviewer?job=${jobId}`}>Set it up</Link></p>}
      <section className="flex flex-wrap items-center gap-4 text-[13px]" aria-label="Role settings">
        <label className="inline-flex items-center gap-2 text-muted">Status <select className="input !h-8 !w-auto !py-0 text-xs" value={job?.status} onChange={(e) => void patch({ status: e.target.value })}><option value="open">Open</option><option value="closed">Closed</option></select></label>
        <label className="inline-flex items-center gap-2 text-muted">Assessment <select className="input !h-8 !w-auto !py-0 text-xs" value={job?.assessment_id ?? ""} onChange={(e) => void patch(e.target.value ? { assessment_id: Number(e.target.value) } : { clear_assessment: true })}><option value="">None</option>{(assessments.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
        <Link href="/teams/assessments" className="text-brand hover:underline">Manage assessments</Link>
      </section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Pipeline summary"><Stat label="Invited" value={p?.summary.invited ?? "–"} /><Stat label="AI-interviewed" value={p?.summary.interviewed ?? "–"} /><Stat label="Suggested to advance" value={p?.summary.recommended ?? "–"} /><Stat label="Assessments done" value={p?.summary.assessed ?? "–"} /></section>
      {!!p?.summary.finished_last_day && <section className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft p-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-brand-fg"><Sparkles size={17} /></span><p className="min-w-0 flex-1 text-[13px]"><b>In the last 24 hours, {p.summary.finished_last_day} {p.summary.finished_last_day === 1 ? "candidate" : "candidates"} finished the AI interview.</b> <span className="text-muted">{p.summary.recommended_last_day} {p.summary.recommended_last_day === 1 ? "is" : "are"} suggested to advance. A person makes every decision.</span></p></section>}
      <div className="flex flex-wrap items-center gap-3"><button type="button" aria-pressed={rec} onClick={() => setRec(!rec)} className={`btn btn-sm ${rec ? "border-brand bg-brand-soft text-brand" : ""}`}>Suggested to advance only</button><span className="text-xs text-muted">The score comes from the AI interview and is advice for you, not a decision</span></div>
      {pipe.isLoading ? <Skeleton className="h-64" /> : pipe.error ? <ErrorNote>Could not load the pipeline.</ErrorNote> : p && (
        <div className="-mx-1 overflow-x-auto pb-3" data-lenis-prevent><div className="flex min-w-max gap-3 px-1">
          {p.columns.map((col) => { const cards = col.cards.filter((c) => !rec || c.recommendation === "advance"); return (
            <section key={col.stage} aria-label={col.name} className="w-[270px] shrink-0 rounded-xl border border-line bg-surface2/50 p-3">
              <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-[13px] font-semibold"><span className={`h-2 w-2 rounded-full ${DOT[col.stage]}`} />{col.name}</h2><span className="text-xs tabular-nums text-muted">{col.cards.length}</span></div>
              <div className="space-y-2">{cards.map((c, i) => (
                <div key={c.id} className="card p-3"><Link href={`/teams/candidates/${c.id}`} className="block"><div className="flex items-center gap-2.5"><Avatar name={c.name} i={i} size={32} /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold hover:text-brand">{c.name}</p><p className="truncate text-xs text-muted">{c.school || c.email || "No details"}</p></div>
                  {c.ai_score !== null ? <span className={`chip ${scoreTone(c.ai_score)}`} title="AI interview score">{c.ai_score}</span> : <span className="text-xs text-subtle">–</span>}</div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">{c.recommendation && <span className={`chip ${REC[c.recommendation][1]}`}>{REC[c.recommendation][0]}</span>}{c.tags.map((t) => <span key={t} className="chip bg-surface2 text-muted">{t}</span>)}</div></Link>
                  <div className="mt-2.5 flex items-center justify-between gap-2"><label className="flex items-center gap-1.5 text-[11px] text-muted">Move to <select className="input !h-7 !w-auto !py-0 text-[11px]" value={c.stage} onChange={(e) => void move(c, e.target.value)}>{STAGES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
                    {!c.joined && <button className="btn btn-ghost btn-sm !px-1.5" title="Copy invite link" aria-label={`Copy invite link for ${c.name}`} onClick={async () => toast((await copy(fullUrl(c.invite_path))) ? "Link copied" : "Copy failed", "info")}><Copy size={12} /></button>}</div></div>))}
                {!cards.length && <p className="px-1 py-4 text-center text-xs text-subtle">Nobody here</p>}</div>
            </section>); })}
        </div>{!!p.rejected.length && <p className="mt-3 px-1 text-xs text-muted">{p.rejected.length} rejected: {p.rejected.map((c) => <Link key={c.id} href={`/teams/candidates/${c.id}`} className="mr-2 underline">{c.name}</Link>)}</p>}</div>)}
    </div>
  );
}
