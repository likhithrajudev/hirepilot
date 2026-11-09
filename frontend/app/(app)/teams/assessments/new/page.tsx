"use client";

import { ChevronLeft, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/providers";
import { ErrorNote, PageHeader } from "@/components/ui";
import { api, ApiError, json } from "@/lib/api";
import type { AssessmentDef, AssessmentQuestion } from "@/lib/teams";

type Choice = { id: string; title: string; difficulty: string };

function Editor() {
  const id = Number(useSearchParams().get("id")) || 0;
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [def, setDef] = useState<AssessmentDef>({ title: "", duration_min: 60, cutoff: 65, questions: [] });
  const [choices, setChoices] = useState<Choice[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<Choice[]>("/assessments/problems").then(setChoices).catch(() => {}); }, []);
  useEffect(() => { if (id) void api<AssessmentDef>(`/assessments/${id}`).then(setDef).catch(() => setErr("Could not load this assessment.")); }, [id]);
  const setQ = (i: number, q: AssessmentQuestion) => setDef({ ...def, questions: def.questions.map((x, j) => (j === i ? q : x)) });
  const valid = def.title.trim().length >= 3 && def.questions.length > 0 && def.questions.every((q) => q.kind === "problem" ? !!q.problem_id : q.text.trim().length >= 5 && q.options.length >= 2 && q.options.every((o) => o.trim()));
  const save = async () => {
    setBusy(true); setErr("");
    try { await api(id ? `/assessments/${id}` : "/assessments", json(def, id ? "PUT" : "POST")); void qc.invalidateQueries({ queryKey: ["assessments"] }); toast("Assessment saved", "success"); router.push("/teams/assessments"); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save the assessment"); } finally { setBusy(false); }
  };
  const total = def.questions.reduce((n, q) => n + q.points, 0);
  return (
    <div className="space-y-5">
      <Link href="/teams/assessments" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft size={14} /> Assessments</Link>
      <PageHeader eyebrow="Hiring · Assessments" title={id ? "Edit assessment" : "New assessment"} subtitle="Multiple-choice questions are graded for you. Coding problems come from the library and are graded by running the candidate's code against every test."
        actions={<button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>Save assessment</button>} />
      {err && <ErrorNote>{err}</ErrorNote>}
      <section className="card grid gap-3 p-5 sm:grid-cols-3"><label className="space-y-1 sm:col-span-3"><span className="label !mb-0">Title</span><input className="input" value={def.title} maxLength={200} placeholder="Backend Engineer: online assessment" onChange={(e) => setDef({ ...def, title: e.target.value })} /></label>
        <label className="space-y-1"><span className="label !mb-0">Time limit (minutes)</span><input type="number" min={10} max={180} className="input" value={def.duration_min} onChange={(e) => setDef({ ...def, duration_min: Number(e.target.value) })} /></label>
        <label className="space-y-1"><span className="label !mb-0">Cut-off (%)</span><input type="number" min={1} max={100} className="input" value={def.cutoff} onChange={(e) => setDef({ ...def, cutoff: Number(e.target.value) })} /></label>
        <p className="self-end pb-2 text-xs text-muted">{def.questions.length} questions · {total} points</p></section>
      <ol className="space-y-3">{def.questions.map((q, i) => (
        <li key={i} className="card space-y-3 p-4"><div className="flex items-center justify-between gap-3"><p className="eyebrow">Question {i + 1} · {q.kind === "mc" ? "Multiple choice" : "Coding problem"}</p>
          <div className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-xs text-muted">Points <input type="number" min={1} max={100} className="input !h-7 !w-16 !py-0 text-xs" value={q.points} onChange={(e) => setQ(i, { ...q, points: Math.max(1, Number(e.target.value) || 1) })} /></label><button className="btn btn-ghost btn-sm !px-1.5" aria-label={`Remove question ${i + 1}`} onClick={() => setDef({ ...def, questions: def.questions.filter((_, j) => j !== i) })}><X size={14} /></button></div></div>
          {q.kind === "problem" ? <label className="block"><span className="sr-only">Problem</span><select className="input" value={q.problem_id} onChange={(e) => setQ(i, { ...q, problem_id: e.target.value })}><option value="">Choose a problem</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.title} ({c.difficulty})</option>)}</select></label> : (<>
            <label className="block"><span className="sr-only">Question text</span><textarea className="input" rows={2} maxLength={600} placeholder="The question" value={q.text} onChange={(e) => setQ(i, { ...q, text: e.target.value })} /></label>
            <label className="block"><span className="sr-only">Code to show (optional)</span><textarea className="input font-mono text-xs" rows={q.code ? 4 : 1} maxLength={2000} placeholder="Code to show with the question (optional)" value={q.code ?? ""} onChange={(e) => setQ(i, { ...q, code: e.target.value })} /></label>
            <fieldset className="space-y-2"><legend className="label">Options (select the correct one)</legend>{q.options.map((o, n) => <div key={n} className="flex items-center gap-2"><input type="radio" name={`c${i}`} aria-label={`Option ${n + 1} is correct`} checked={q.correct === n} onChange={() => setQ(i, { ...q, correct: n })} /><input className="input" aria-label={`Option ${n + 1}`} maxLength={300} value={o} onChange={(e) => setQ(i, { ...q, options: q.options.map((x, k) => (k === n ? e.target.value : x)) })} />{q.options.length > 2 && <button className="btn btn-ghost btn-sm !px-1.5" aria-label={`Remove option ${n + 1}`} onClick={() => setQ(i, { ...q, options: q.options.filter((_, k) => k !== n), correct: q.correct === n ? 0 : q.correct > n ? q.correct - 1 : q.correct })}><X size={13} /></button>}</div>)}
              {q.options.length < 6 && <button className="btn btn-sm" onClick={() => setQ(i, { ...q, options: [...q.options, ""] })}><Plus size={13} /> Add option</button>}</fieldset></>)}</li>))}</ol>
      <div className="flex flex-wrap gap-2"><button className="btn" disabled={def.questions.length >= 30} onClick={() => setDef({ ...def, questions: [...def.questions, { kind: "mc", text: "", code: "", options: ["", ""], correct: 0, points: 5 }] })}><Plus size={14} /> Multiple choice</button><button className="btn" disabled={def.questions.length >= 30} onClick={() => setDef({ ...def, questions: [...def.questions, { kind: "problem", problem_id: "", points: 15 }] })}><Plus size={14} /> Coding problem</button></div>
    </div>
  );
}

export default function NewAssessment() { return <Suspense><Editor /></Suspense>; }
