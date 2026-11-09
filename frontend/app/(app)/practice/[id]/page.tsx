"use client";

import { ChevronLeft, Clock, Loader2, Play, Send } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { useCollapseSidebar } from "@/components/Sidebar";
import { Badge, ErrorNote, Skeleton, timeAgo } from "@/components/ui";
import { api, ApiError, json } from "@/lib/api";
import type { CodeLanguage, CodeResult } from "@/lib/coding";
import { DIFF_TONE, usePracticeProblem } from "@/lib/practice";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">Loading editor…</p> });
const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const tab = (on: boolean) => `border-b-2 px-3 py-2.5 text-[13px] transition-colors ${on ? "border-brand font-semibold text-fg" : "border-transparent font-medium text-muted hover:text-fg"}`;

function Workspace() {
  useCollapseSidebar();
  const id = useParams<{ id: string }>().id;
  const contest = Number(useSearchParams().get("contest")) || 0;   // set when this problem is opened from a live contest: runs then count for that contest
  const { data: p, error } = usePracticeProblem(id);
  const qc = useQueryClient();
  const [lang, setLang] = useState<CodeLanguage>("python");
  const [source, setSource] = useState("");
  const [left, setLeft] = useState<"description" | "submissions">("description");
  const [bottom, setBottom] = useState<"tests" | "result">("tests");
  const [caseIdx, setCaseIdx] = useState(0);
  const [busy, setBusy] = useState<"" | "examples" | "submit">("");
  const [result, setResult] = useState<{ r: CodeResult; mode: "examples" | "submit" } | null>(null);
  const [err, setErr] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [runner, setRunner] = useState<{ ready: boolean; message: string } | null>(null);
  const loaded = useRef("");

  useEffect(() => { const t = setInterval(() => setElapsed((s) => s + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { void api<{ ready: boolean; message: string }>("/interviews/coding/status").then(setRunner).catch(() => setRunner({ ready: false, message: "Could not check the code runner." })); }, []);
  // Your code is kept in this browser per problem and language, so a refresh or a language switch never loses it.
  useEffect(() => {
    if (!p) return;
    const key = `hp_practice_${p.id}_${lang}`;
    let saved: string | null = null;
    try { saved = localStorage.getItem(key); } catch {}
    loaded.current = key; setSource(saved ?? p.starters[lang]);
  }, [p, lang]);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => { try { localStorage.setItem(loaded.current, source); } catch {} }, 400);
    return () => clearTimeout(t);
  }, [source]);

  const run = async (mode: "examples" | "submit") => {
    if (!p || busy) return;
    setBusy(mode); setErr(""); setBottom("result");
    try {
      const r = await api<CodeResult>(contest ? `/contests/${contest}/problems/${p.id}/run` : `/practice/problems/${p.id}/run`, json({ language: lang, source, mode }));
      setResult({ r, mode });
      void qc.invalidateQueries({ queryKey: ["practice"] }); if (contest) void qc.invalidateQueries({ queryKey: ["contests"] });
    } catch (e) { setResult(null); setErr(e instanceof ApiError ? e.message : "Could not run your code. Try again."); }
    finally { setBusy(""); }
  };

  if (error) return <div className="workspace-page"><ErrorNote>{error instanceof ApiError && error.status === 404 ? "That problem does not exist." : "Could not load the problem."}</ErrorNote><Link href="/practice" className="btn mt-4"><ChevronLeft size={15} /> Problem library</Link></div>;
  if (!p) return <div className="space-y-4 p-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-[60vh]" /></div>;

  const failing = result?.r.cases.find((c) => c.status !== "passed" && !c.hidden);
  const verdict = !result ? "" : result.r.status === "accepted" ? (result.mode === "submit" ? "Accepted" : "All example tests passed") : result.r.status === "failed" ? "Wrong answer" : result.r.status.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
  const ok = result?.r.status === "accepted";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[560px] flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <Link href={contest ? `/contests/${contest}` : "/practice"} className="btn btn-ghost btn-sm" aria-label={contest ? "Back to the contest" : "Back to the problem library"}><ChevronLeft size={14} /> {contest ? "Contest" : "Practice"}</Link>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1 truncate text-[13px] text-muted">{p.topic} <span className="px-1">/</span> <span className="font-semibold text-fg">{p.title}</span></nav>
        <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted" aria-label="Time on this problem"><Clock size={13} />{clock(elapsed)}</span>
        <button className="btn btn-sm" disabled={!!busy} onClick={() => void run("examples")}>{busy === "examples" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run</button>
        <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void run("submit")}>{busy === "submit" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Submit</button>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section aria-label="Problem" className="flex min-h-0 flex-col border-line lg:border-r">
          <div role="tablist" aria-label="Problem sections" className="flex shrink-0 gap-1 border-b border-line px-3">
            <button role="tab" aria-selected={left === "description"} className={tab(left === "description")} onClick={() => setLeft("description")}>Description</button>
            <button role="tab" aria-selected={left === "submissions"} className={tab(left === "submissions")} onClick={() => setLeft("submissions")}>Submissions <span className="text-subtle">· {p.attempts.length}</span></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5" data-lenis-prevent>
            {left === "description" ? (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[22px] font-bold tracking-tight">{p.title}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted"><Badge tone={DIFF_TONE[p.difficulty]} className="capitalize">{p.difficulty}</Badge><span>{p.points} points</span><span>·</span><span>{p.case_count} tests ({p.hidden_count} hidden)</span></div>
                </div>
                <p className="text-[14px] leading-relaxed">{p.statement}</p>
                <div><p className="eyebrow mb-1.5">Input format</p><p className="text-[13px] leading-relaxed text-muted">{p.input_format}</p></div>
                {p.examples.map((e, i) => (
                  <div key={e.name} className="rounded-lg border border-line bg-surface2/60 p-3.5 text-[13px]">
                    <p className="eyebrow mb-2">Example {i + 1} · {e.name}</p>
                    <p className="text-xs text-muted">Input</p><pre className="mb-2 mt-0.5 overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px]">{e.input.length > 400 ? e.input.slice(0, 400) + "…" : e.input}</pre>
                    <p className="text-xs text-muted">Output</p><pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px]">{e.expected.length > 400 ? e.expected.slice(0, 400) + "…" : e.expected}</pre>
                  </div>
                ))}
                <div><p className="eyebrow mb-1.5">Constraints</p><p className="text-[13px] leading-relaxed text-muted">{p.constraints}</p></div>
                <div className="flex flex-wrap gap-2"><Badge>{p.topic}</Badge></div>
              </div>
            ) : p.attempts.length ? (
              <ul className="space-y-2">{p.attempts.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-2.5 text-[13px]">
                  <span><b className="capitalize">{a.mode === "submit" ? "Submission" : "Example run"}</b> <span className="text-muted">· {p.languages[a.language]?.label ?? a.language} · {timeAgo(a.created_at)}</span></span>
                  <Badge tone={a.status === "accepted" ? "ok" : "bad"}>{a.status === "accepted" ? "Accepted" : `${a.passed}/${a.total} passed`}</Badge>
                </li>))}</ul>
            ) : <p className="text-sm text-muted">No attempts yet. Run your code against the examples, then submit it.</p>}
          </div>
        </section>
        <div className="flex min-h-0 flex-col">
          <section aria-label="Code editor" className="flex min-h-[260px] min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1.5">
              <label className="flex items-center gap-2 text-xs text-muted">Language
                <select className="input !h-8 !w-auto !py-0 text-xs" value={lang} onChange={(e) => setLang(e.target.value as CodeLanguage)}>{(Object.keys(p.languages) as CodeLanguage[]).map((k) => <option key={k} value={k}>{p.languages[k].label}</option>)}</select></label>
              <span className="text-xs text-subtle">Saved in this browser</span>
              <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setSource(p.starters[lang])}>Reset</button>
            </div>
            <div className="min-h-0 flex-1 bg-[#1e1e1e]"><Editor language={p.languages[lang].monaco} theme="vs-dark" value={source} onChange={(v) => setSource(v ?? "")} options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 4, padding: { top: 12 } }} /></div>
          </section>
          <section aria-label="Tests and results" className="flex max-h-[42%] min-h-[170px] shrink-0 flex-col border-t border-line">
            <div role="tablist" aria-label="Output" className="flex shrink-0 gap-1 border-b border-line px-3">
              <button role="tab" aria-selected={bottom === "tests"} className={tab(bottom === "tests")} onClick={() => setBottom("tests")}>Test cases</button>
              <button role="tab" aria-selected={bottom === "result"} className={tab(bottom === "result")} onClick={() => setBottom("result")}>Result</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[13px]" data-lenis-prevent>
              {bottom === "tests" ? (
                <div>
                  <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Example cases">{p.examples.map((e, i) => <button key={e.name} type="button" aria-pressed={caseIdx === i} onClick={() => setCaseIdx(i)} className={`chip cursor-pointer border ${caseIdx === i ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}>Case {i + 1}</button>)}</div>
                  {p.examples[caseIdx] && <><p className="text-xs text-muted">Input</p><pre className="mb-2 mt-0.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface2 p-2.5 font-mono text-[12.5px]">{p.examples[caseIdx].input}</pre><p className="text-xs text-muted">Expected output</p><pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface2 p-2.5 font-mono text-[12.5px]">{p.examples[caseIdx].expected}</pre></>}
                  {runner && !runner.ready && <p className="mt-3 text-xs text-warn">{runner.message}</p>}
                </div>
              ) : busy ? <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> {busy === "submit" ? "Running every test, including the hidden ones…" : "Running the example tests…"}</p>
                : err ? <ErrorNote>{err}</ErrorNote>
                : result ? (
                  <div className="space-y-3">
                    <div><p className={`text-[17px] font-bold ${ok ? "text-ok" : "text-bad"}`}>{verdict}</p><p className="text-xs text-muted">{result.r.passed} / {result.r.total} tests passed{result.r.message ? "" : ""}</p></div>
                    {result.r.message && <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-bad-soft p-2.5 font-mono text-[12px] text-bad">{result.r.message}</pre>}
                    <div className="flex flex-wrap gap-1.5">{result.r.cases.map((c, i) => <Badge key={i} tone={c.status === "passed" ? "ok" : "bad"}>{c.label}</Badge>)}</div>
                    {failing && <div className="grid gap-2 sm:grid-cols-2"><div><p className="text-xs text-muted">Your output</p><pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface2 p-2.5 font-mono text-[12.5px]">{failing.output || "(nothing)"}</pre></div><div><p className="text-xs text-muted">Expected</p><pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface2 p-2.5 font-mono text-[12.5px]">{failing.expected}</pre></div></div>}
                  </div>
                ) : <p className="text-muted">Run your code to see results here.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function ProblemWorkspace() { return <Suspense><Workspace /></Suspense>; }
