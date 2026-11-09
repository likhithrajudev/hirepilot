"use client";

import { ArrowDown, ArrowUp, Check, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/providers";
import { EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { SegControl } from "@/components/teams/parts";
import { api, ApiError, json } from "@/lib/api";
import { INTERVIEWERS } from "@/lib/interviewers";
import { useTeamJob, useTeamJobs, type InterviewerConfig, type QuestionPlan } from "@/lib/teams";

const TYPES = ["Technical", "Behavioral", "Coding", "Mixed"] as const;
const SUGGESTED = ["API design", "Concurrency", "System design", "Observability", "Communication", "Data modelling", "Ownership", "Testing"];
const FOLLOW = ["None", "Up to 1", "Up to 2", "Up to 3"] as const;
const BLANK: InterviewerConfig = { type: "Technical", minutes: 30, language: "English (India)", seniority: "SDE I (0–2 yrs)", competencies: [], questions: [], persona: "Karthik", intensity: 3, rules: { tab_paste: true, camera: true }, published: false };
const RULES: [string, string, string][] = [["tab_paste", "Tab switching and pasting", "Shown to you as signals in the candidate's report. Never an automatic rejection."], ["camera", "Camera presence and gaze", "Analysed on the candidate's own device; the video is never recorded or uploaded."]];

function Builder() {
  const router = useRouter();
  const qs = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const jobs = useTeamJobs();
  const jobId = Number(qs.get("job")) || jobs.data?.[0]?.id || 0;
  const job = useTeamJob(jobId);
  const [cfg, setCfg] = useState<InterviewerConfig>(BLANK);
  const [custom, setCustom] = useState("");
  const [gen, setGen] = useState<null | string>(null);
  const [busy, setBusy] = useState("");
  useEffect(() => { if (job.data) setCfg({ ...BLANK, ...job.data.interviewer, rules: { ...BLANK.rules, ...job.data.interviewer.rules } }); }, [job.data]);
  const set = (p: Partial<InterviewerConfig>) => setCfg((c) => ({ ...c, ...p }));
  const setQ = (i: number, p: Partial<QuestionPlan>) => set({ questions: cfg.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) });
  const swap = (i: number, d: number) => { const a = [...cfg.questions]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; set({ questions: a }); };
  const comps = Array.from(new Set([...SUGGESTED, ...cfg.competencies]));
  const save = async (published: boolean) => {
    setBusy("save");
    try { await api(`/teams/jobs/${jobId}/interviewer`, json({ ...cfg, published }, "PUT")); toast(published ? "Published. You can invite candidates." : "Saved", "success"); void qc.invalidateQueries({ queryKey: ["teams"] }); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not save", "error"); } finally { setBusy(""); }
  };
  const generate = async () => {
    setBusy("gen");
    try { const r = await api<{ competencies: string[]; questions: QuestionPlan[] }>(`/teams/jobs/${jobId}/interviewer/generate`, json({ description: gen })); set({ questions: [...cfg.questions, ...r.questions], competencies: Array.from(new Set([...cfg.competencies, ...r.competencies])) }); setGen(null); toast(`Added ${r.questions.length} questions. Read them and edit anything.`, "success"); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not draft questions", "error"); } finally { setBusy(""); }
  };

  if (jobs.isLoading) return <Skeleton className="h-64" />;
  if (!jobs.data?.length) return <EmptyState icon={<Sparkles size={22} />} title="Create a role first" body="The AI interviewer is designed per role." action={<Link href="/teams" className="btn btn-primary">Go to pipeline</Link>} />;
  if (job.error) return <ErrorNote>Could not load this role.</ErrorNote>;
  const persona = INTERVIEWERS.find((p) => p.name === cfg.persona);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Configure" title="Design the conversation every candidate gets." subtitle={<span className="inline-flex flex-wrap items-center gap-2">The AI interviewer follows your plan and asks adaptive follow-ups, the same way for everyone. Role: <select className="input !h-8 !w-auto !py-0 text-xs" aria-label="Role" value={jobId} onChange={(e) => router.replace(`/teams/interviewer?job=${e.target.value}`)}>{jobs.data.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select></span>}
        actions={<><span className={`chip ${cfg.published ? "bg-ok-soft text-ok" : "bg-surface2 text-muted"}`}>{cfg.published ? "Published" : "Draft"}</span><Link href="/interviews" className="btn">Try it as a candidate</Link>
          {cfg.published ? <><button className="btn" disabled={!!busy} onClick={() => void save(false)}>Unpublish</button><button className="btn btn-primary" disabled={!!busy} onClick={() => void save(true)}>Save changes</button></> : <><button className="btn" disabled={!!busy} onClick={() => void save(false)}>Save draft</button><button className="btn btn-primary" disabled={!!busy || (!cfg.questions.length && !cfg.competencies.length)} onClick={() => void save(true)}>Publish</button></>}</>} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="card space-y-4 p-5"><h2 className="font-semibold">1 · Format</h2><SegControl items={TYPES} value={cfg.type} onChange={(v) => set({ type: v })} label="Interview type" />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1"><span className="label !mb-0">Duration</span><select className="input" value={cfg.minutes} onChange={(e) => set({ minutes: Number(e.target.value) })}>{[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
              <label className="space-y-1"><span className="label !mb-0">Language</span><select className="input" value={cfg.language} onChange={(e) => set({ language: e.target.value })}>{["English (India)", "English (US)", "Hindi and English"].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="space-y-1"><span className="label !mb-0">Seniority</span><select className="input" value={cfg.seniority} onChange={(e) => set({ seniority: e.target.value })}>{["Intern", "SDE I (0–2 yrs)", "SDE II"].map((x) => <option key={x}>{x}</option>)}</select></label></div>
            {cfg.type === "Coding" && <p className="text-xs text-muted">A coding interview opens the code editor with problems from the library.</p>}</section>
          <section className="card p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">2 · Competencies to score</h2><span className="text-xs text-muted">{cfg.competencies.length} selected</span></div>
            <div className="mt-3 flex flex-wrap gap-2">{comps.map((c) => { const on = cfg.competencies.includes(c); return <button key={c} type="button" aria-pressed={on} onClick={() => set({ competencies: on ? cfg.competencies.filter((x) => x !== c) : [...cfg.competencies, c] })} className={`chip cursor-pointer border !px-3 !py-1.5 text-[12.5px] ${on ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}>{on ? <Check size={12} /> : <Plus size={12} />}{c}</button>; })}</div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = custom.trim(); if (v && !cfg.competencies.includes(v)) set({ competencies: [...cfg.competencies, v.slice(0, 60)] }); setCustom(""); }}><label className="flex-1"><span className="sr-only">Add your own competency</span><input className="input" placeholder="Add your own" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={60} /></label><button className="btn" disabled={!custom.trim()}>Add</button></form></section>
          <section className="card p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">3 · Question plan</h2><div className="flex gap-2"><button className="btn btn-sm" onClick={() => setGen(gen === null ? "" : null)}><Sparkles size={13} /> Draft from the job description</button><button className="btn btn-sm" disabled={cfg.questions.length >= 12} onClick={() => set({ questions: [...cfg.questions, { text: "", comp: "", minutes: 5, followups: "Up to 2" }] })}><Plus size={13} /> Add question</button></div></div>
            {gen !== null && <div className="mt-3 space-y-2 rounded-lg border border-line p-3"><label className="block"><span className="label">Paste the job description</span><textarea className="input" rows={5} value={gen} maxLength={6000} onChange={(e) => setGen(e.target.value)} /></label><div className="flex items-center gap-2"><button className="btn btn-primary btn-sm" disabled={busy === "gen" || gen.trim().length < 20} onClick={() => void generate()}>{busy === "gen" ? "Drafting…" : "Draft questions"}</button><span className="text-xs text-muted">Uses your AI allowance. The questions are added below for you to edit.</span></div></div>}
            {!cfg.questions.length ? <p className="mt-3 text-sm text-muted">No fixed questions. The interviewer will choose its own based on your competencies and the role. Add questions to make every candidate get the same ones.</p> : (
              <ol className="mt-3 space-y-2">{cfg.questions.map((q, i) => (
                <li key={i} className="rounded-lg border border-line p-3"><div className="flex items-start gap-2"><span className="mt-2 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface2 text-xs font-bold">{i + 1}</span>
                  <label className="min-w-0 flex-1"><span className="sr-only">Question {i + 1}</span><textarea className="input" rows={2} maxLength={400} placeholder="The question as the interviewer should ask it" value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} /></label>
                  <div className="flex shrink-0 flex-col"><button className="btn btn-ghost btn-sm !px-1.5" aria-label="Move up" disabled={i === 0} onClick={() => swap(i, -1)}><ArrowUp size={13} /></button><button className="btn btn-ghost btn-sm !px-1.5" aria-label="Move down" disabled={i === cfg.questions.length - 1} onClick={() => swap(i, 1)}><ArrowDown size={13} /></button></div>
                  <button className="btn btn-ghost btn-sm !px-1.5" aria-label={`Remove question ${i + 1}`} onClick={() => set({ questions: cfg.questions.filter((_, j) => j !== i) })}><X size={14} /></button></div>
                  <div className="mt-2 flex flex-wrap gap-3 pl-8 text-xs text-muted"><label className="flex items-center gap-1.5">Competency <select className="input !h-7 !w-auto !py-0 text-xs" value={q.comp} onChange={(e) => setQ(i, { comp: e.target.value })}><option value="">None</option>{comps.map((c) => <option key={c}>{c}</option>)}</select></label>
                    <label className="flex items-center gap-1.5">About <input type="number" min={1} max={20} className="input !h-7 !w-16 !py-0 text-xs" value={q.minutes} onChange={(e) => setQ(i, { minutes: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} /> min</label>
                    <label className="flex items-center gap-1.5">Follow-ups <select className="input !h-7 !w-auto !py-0 text-xs" value={q.followups} onChange={(e) => setQ(i, { followups: e.target.value as QuestionPlan["followups"] })}>{FOLLOW.map((x) => <option key={x}>{x}</option>)}</select></label></div></li>))}</ol>)}</section>
          <section className="card p-5"><h2 className="font-semibold">4 · Interviewer</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">{INTERVIEWERS.map((p) => <button key={p.name} type="button" aria-pressed={cfg.persona === p.name} onClick={() => set({ persona: p.name })} className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left ${cfg.persona === p.name ? "border-brand bg-brand-soft" : "border-line"}`}><span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-sm font-bold text-brand-fg">{p.name[0]}</span><span><span className="block text-sm font-semibold">{p.name}</span><span className="block text-xs text-muted">{p.title.replace(/^The /, "")} · {p.style.toLowerCase()}</span></span></button>)}</div>
            <label className="mt-4 block"><span className="label">Probing intensity</span><input type="range" min={1} max={5} value={cfg.intensity} onChange={(e) => set({ intensity: Number(e.target.value) })} className="w-full" /><span className="flex justify-between text-xs text-muted"><span>Supportive</span><span>Balanced</span><span>Rigorous</span></span></label></section>
          <section className="card p-5"><h2 className="font-semibold">5 · Integrity</h2><p className="mt-1 text-xs text-muted">Monitoring only runs if the candidate agrees on the invite page. The audio of every interview is recorded for the candidate and is not shared with you.</p>
            <div className="mt-3 space-y-2">{RULES.map(([k, l, d]) => <label key={k} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3"><input type="checkbox" className="mt-1" checked={!!cfg.rules[k]} onChange={() => set({ rules: { ...cfg.rules, [k]: !cfg.rules[k] } })} /><span><span className="block text-sm font-semibold">{l}</span><span className="block text-xs text-muted">{d}</span></span></label>)}</div></section>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20">
          <section className="card p-5"><p className="eyebrow">Summary</p><p className="mt-1 text-lg font-bold">{cfg.type} screen</p>
            <dl className="mt-3 space-y-2 text-[13px]">{[["Questions", cfg.questions.length ? `${cfg.questions.length} + follow-ups` : "Chosen by the interviewer"], ["Length", `${cfg.minutes} min`], ["Interviewer", persona ? `${persona.name} · ${persona.style.toLowerCase()}` : cfg.persona], ["Scored on", `${cfg.competencies.length} competencies`], ["Monitoring", cfg.rules.tab_paste || cfg.rules.camera ? "With candidate consent" : "Off"]].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl></section>
          <section className="card p-5"><h2 className="text-sm font-semibold">Candidate invite</h2><p className="mt-2 text-[13px] leading-relaxed text-muted">{cfg.published ? "Published. Invite candidates from the pipeline: each gets a private link, signs in, sees what you will see, and then starts." : "Publish this interviewer to start inviting candidates from the pipeline."}</p><Link href="/teams" className="btn btn-sm mt-3">Open the pipeline</Link></section>
        </aside>
      </div>
    </div>
  );
}

export default function InterviewerBuilder() { return <Suspense><Builder /></Suspense>; }
