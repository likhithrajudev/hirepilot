"use client";

import { Clock, Loader2, Play, Send } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "@/components/Dialog";
import { Badge, ErrorNote, Skeleton } from "@/components/ui";
import { api, ApiError, json } from "@/lib/api";
import type { CodeLanguage, CodeResult, CodingProblem } from "@/lib/coding";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">Loading editor…</p> });
type Q = { index: number; kind: "mc" | "problem"; points: number; text?: string; code?: string; options?: string[]; problem?: CodingProblem & { languages: Record<CodeLanguage, { label: string; file: string; monaco: string }>; starters: Record<CodeLanguage, string> } };
interface Attempt { id: number; title: string; status: "active" | "done"; seconds_left: number; questions: Q[]; answers: Record<string, number | { passed: number; total: number; language: string }> }
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function TakeAssessment() {
  const id = Number(useParams<{ id: string }>().id) || 0;
  const dialog = useDialog();
  const [a, setA] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Attempt["answers"]>({});
  const [flag, setFlag] = useState<Set<number>>(new Set());
  const [ends, setEnds] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState(false);
  const [lang, setLang] = useState<CodeLanguage>("python");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<"" | "examples" | "submit">("");
  const [result, setResult] = useState<{ r: CodeResult; mode: string } | null>(null);
  const [msg, setMsg] = useState("");
  const loaded = useRef("");

  useEffect(() => { void api<Attempt>(`/assessments/attempts/${id}`).then((x) => { setA(x); setAnswers(x.answers); setEnds(Date.now() + x.seconds_left * 1000); setDone(x.status === "done"); }).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the assessment")); }, [id]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.floor((ends - now) / 1000));
  const finish = useCallback(async () => { try { await api(`/assessments/attempts/${id}/finish`, { method: "POST" }); } catch {} setDone(true); }, [id]);
  useEffect(() => { if (a && !done && ends && left === 0) void finish(); }, [a, done, ends, left, finish]);

  const q = a?.questions[i];
  useEffect(() => {   // your code is kept in this browser per question and language
    if (!q || q.kind !== "problem" || !q.problem) return;
    const key = `hp_assess_${id}_${i}_${lang}`; let saved: string | null = null;
    try { saved = localStorage.getItem(key); } catch {}
    loaded.current = key; setSource(saved ?? q.problem.starters[lang]); setResult(null); setMsg("");
  }, [q, id, i, lang]);
  useEffect(() => { if (!loaded.current) return; const t = setTimeout(() => { try { localStorage.setItem(loaded.current, source); } catch {} }, 400); return () => clearTimeout(t); }, [source]);

  const choose = async (n: number) => {
    setAnswers((x) => ({ ...x, [String(i)]: n }));
    try { await api(`/assessments/attempts/${id}/answers`, json({ index: i, choice: n }, "PUT")); setMsg(""); } catch (e) { setMsg(e instanceof ApiError ? e.message : "Could not save that answer. Check your connection."); }
  };
  const run = async (mode: "examples" | "submit") => {
    if (busy) return;
    setBusy(mode); setMsg("");
    try {
      const r = await api<CodeResult>(`/assessments/attempts/${id}/problems/${i}/run`, json({ language: lang, source, mode }));
      setResult({ r, mode });
      if (mode === "submit") setAnswers((x) => { const prev = x[String(i)]; const better = typeof prev !== "object" || r.passed / Math.max(1, r.total) >= prev.passed / Math.max(1, prev.total); return better ? { ...x, [String(i)]: { passed: r.passed, total: r.total, language: lang } } : x; });
    } catch (e) { setResult(null); setMsg(e instanceof ApiError ? e.message : "Could not run your code"); } finally { setBusy(""); }
  };
  const end = async () => { if (await dialog.confirm({ title: "Submit your assessment?", body: `You have answered ${Object.keys(answers).length} of ${a?.questions.length} questions. You cannot change anything after submitting.`, confirmLabel: "Submit" })) await finish(); };

  if (error) return <div className="workspace-page"><ErrorNote>{error}</ErrorNote></div>;
  if (!a) return <div className="space-y-4 p-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-[60vh]" /></div>;
  const answered = (n: number) => answers[String(n)] !== undefined;
  const p = q?.problem;
  const sub = q && typeof answers[String(i)] === "object" ? (answers[String(i)] as { passed: number; total: number }) : null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-semibold">{a.title}</p><p className="text-xs text-muted">Answers are saved as you go</p></div>
        {!done && <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-sm tabular-nums ${left < 300 ? "border-bad text-bad" : "border-line"}`} role="timer" aria-label="Time left"><Clock size={14} />{clock(left)}<span className="text-xs text-muted">left</span></span>}
        {!done && <button className="btn btn-primary btn-sm" onClick={() => void end()}>Submit assessment</button>}
      </header>
      {done ? (
        <main className="grid flex-1 place-items-center p-6"><div className="card max-w-md p-8 text-center"><h1 className="text-xl font-bold">Submitted</h1><p className="mt-2 text-sm text-muted">Thank you. The hiring team will review your results and be in touch. You can close this page.</p><Link href="/home" className="btn mt-5">Go to my workspace</Link></div></main>
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-line bg-surface p-5 lg:border-r" data-lenis-prevent>
            <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold">Questions</h2><span className="text-xs text-muted">{Object.keys(answers).length} of {a.questions.length}</span></div>
            <div className="mt-3 grid grid-cols-5 gap-2 lg:grid-cols-4">{a.questions.map((x, n) => <button key={n} onClick={() => setI(n)} aria-label={`Question ${n + 1}${n === i ? ", current" : ""}${answered(n) ? ", answered" : ""}${flag.has(n) ? ", flagged" : ""}`} className={`relative grid h-10 place-items-center rounded-lg text-sm font-semibold ${n === i ? "bg-brand text-brand-fg" : answered(n) ? "border border-brand bg-brand-soft text-brand" : "border border-line bg-surface"}`}>{n + 1}{flag.has(n) && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warn" />}</button>)}</div>
          </aside>
          <main className="flex min-h-0 flex-col">
            {q && q.kind === "mc" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8" data-lenis-prevent><div className="mx-auto max-w-3xl">
                <div className="flex items-center justify-between gap-3"><p className="eyebrow">Question {i + 1} · Multiple choice · {q.points} pts</p><button type="button" aria-pressed={flag.has(i)} onClick={() => setFlag((f) => { const nx = new Set(f); if (nx.has(i)) nx.delete(i); else nx.add(i); return nx; })} className={`btn btn-sm ${flag.has(i) ? "border-warn bg-warn-soft text-warn" : ""}`}>{flag.has(i) ? "Flagged" : "Flag for review"}</button></div>
                <h1 className="mt-4 whitespace-pre-wrap text-[22px] font-semibold leading-snug">{q.text}</h1>
                {q.code && <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface2 p-4 font-mono text-[13px]">{q.code}</pre>}
                <fieldset className="mt-6 space-y-2.5"><legend className="sr-only">Choose one answer</legend>{q.options!.map((o, n) => <label key={n} className={`flex cursor-pointer items-start gap-3 rounded-xl border-[1.5px] p-3.5 text-[14px] ${answers[String(i)] === n ? "border-brand bg-brand-soft" : "border-line hover:bg-surface2"}`}><input type="radio" name={`q${i}`} className="mt-1" checked={answers[String(i)] === n} onChange={() => void choose(n)} /><span className="font-mono text-xs text-muted">{"ABCDEF"[n]}</span><span>{o}</span></label>)}</fieldset>
                {msg && <p role="alert" className="mt-3 text-sm text-bad">{msg}</p>}</div></div>
            ) : p && q ? (
              <div className="grid min-h-0 flex-1 lg:grid-cols-2">
                <section className="min-h-0 overflow-y-auto border-line p-5 lg:border-r" data-lenis-prevent><div className="flex items-center justify-between gap-3"><p className="eyebrow">Question {i + 1} · Coding · {q.points} pts</p><button type="button" aria-pressed={flag.has(i)} onClick={() => setFlag((f) => { const nx = new Set(f); if (nx.has(i)) nx.delete(i); else nx.add(i); return nx; })} className={`btn btn-sm ${flag.has(i) ? "border-warn bg-warn-soft text-warn" : ""}`}>{flag.has(i) ? "Flagged" : "Flag"}</button></div>
                  <h1 className="mt-3 text-[20px] font-bold">{p.title}</h1><p className="mt-3 text-[14px] leading-relaxed">{p.statement}</p><p className="eyebrow mb-1 mt-4">Input format</p><p className="text-[13px] text-muted">{p.input_format}</p>
                  {p.examples.map((e, n) => <div key={e.name} className="mt-3 rounded-lg border border-line bg-surface2/60 p-3 text-[13px]"><p className="eyebrow mb-1.5">Example {n + 1}</p><pre className="whitespace-pre-wrap font-mono text-[12.5px]">{e.input.slice(0, 300)}</pre><p className="mt-1.5 text-xs text-muted">Output</p><pre className="font-mono text-[12.5px]">{e.expected.slice(0, 300)}</pre></div>)}
                  <p className="eyebrow mb-1 mt-4">Constraints</p><p className="text-[13px] text-muted">{p.constraints}</p></section>
                <section className="flex min-h-0 flex-col"><div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5"><select className="input !h-8 !w-auto !py-0 text-xs" aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as CodeLanguage)}>{(Object.keys(p.languages) as CodeLanguage[]).map((k) => <option key={k} value={k}>{p.languages[k].label}</option>)}</select>
                  {sub && <Badge tone={sub.passed === sub.total ? "ok" : "warn"}>Best so far: {sub.passed}/{sub.total} tests</Badge>}
                  <button className="btn btn-sm ml-auto" disabled={!!busy} onClick={() => void run("examples")}>{busy === "examples" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run examples</button><button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void run("submit")}>{busy === "submit" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Submit code</button></div>
                  <div className="min-h-0 flex-1 bg-[#1e1e1e]"><Editor language={p.languages[lang].monaco} theme="vs-dark" value={source} onChange={(v) => setSource(v ?? "")} options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 12 } }} /></div>
                  <div className="max-h-[32%] min-h-[88px] shrink-0 overflow-y-auto border-t border-line p-3 text-[13px]" data-lenis-prevent>{msg ? <p role="alert" className="text-bad">{msg}</p> : result ? <div className="space-y-2"><p className={`font-bold ${result.r.status === "accepted" ? "text-ok" : "text-bad"}`}>{result.r.status === "accepted" ? (result.mode === "submit" ? "All tests passed" : "Examples passed") : result.r.status.replaceAll("_", " ")}: {result.r.passed}/{result.r.total}</p>{result.r.message && <pre className="whitespace-pre-wrap font-mono text-xs text-bad">{result.r.message}</pre>}<div className="flex flex-wrap gap-1.5">{result.r.cases.map((c, n) => <Badge key={n} tone={c.status === "passed" ? "ok" : "bad"}>{c.label}</Badge>)}</div></div> : <p className="text-muted">Run the examples to check your approach. Submit to have every test, including hidden ones, counted.</p>}</div></section>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3 sm:px-8"><button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>← Previous</button>{i < a.questions.length - 1 ? <button className="btn btn-primary" onClick={() => setI(i + 1)}>Next →</button> : <button className="btn btn-primary" onClick={() => void end()}>Review and submit</button>}</div>
          </main>
        </div>)}
    </div>
  );
}
