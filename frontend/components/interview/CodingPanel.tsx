"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Code2, Download, Loader2, MessageSquare, Play, Save } from "lucide-react";
import { api, ApiError, json } from "@/lib/api";
import type { CodeLanguage, CodingRun, CodingWorkspace } from "@/lib/coding";
import { useDialog } from "@/components/Dialog";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), { ssr: false });
const label = (value: string) => value.replaceAll("_", " ");

export default function CodingPanel({ sessionId, active, proctored, onFlush, onDiscuss, onAdvance }: {
  sessionId: number; active: boolean; proctored: boolean; onFlush: (fn: () => Promise<void>) => void;
  onDiscuss: (text: string) => void; onAdvance: () => void;
}) {
  const dialog = useDialog();
  const [ws, setWs] = useState<CodingWorkspace | null>(null);
  const [source, setSource] = useState("");
  const [language, setLanguage] = useState<CodeLanguage>("python");
  const [tab, setTab] = useState<"problem" | "editor">("editor");
  const [saveState, setSaveState] = useState("Loading workspace…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [plain, setPlain] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [runner, setRunner] = useState<{ ready: boolean; message: string }>({ ready: false, message: "Checking isolated runner…" });
  const [result, setResult] = useState<CodingRun | null>(null);
  const version = useRef(0), saved = useRef("");
  const task = useRef<Promise<void> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const draft = useRef({ source, language, pid: "" });
  const mounted = useRef(true);
  const disabled = !active || busy;

  const adopt = useCallback((value: CodingWorkspace) => {
    const pid = value.problems[value.active_index].id;
    const solution = value.solutions[pid];
    const code = solution.sources[solution.language] ?? value.starters[solution.language];
    version.current = value.version;
    draft.current = { pid, source: code, language: solution.language };
    saved.current = JSON.stringify(draft.current);
    setWs(value); setSource(code); setLanguage(solution.language); setSaveState("All changes saved");
    setResult(value.runs.find((run) => run.problem_id === pid) ?? null);
  }, []);

  useEffect(() => { let live = true; const check = () => { void api<{ ready: boolean; message: string }>("/interviews/coding/status").then((value) => { if (live) setRunner(value); }).catch(() => { if (live) setRunner({ ready: false, message: "Could not reach the code runner. Code can still be saved." }); }); }; check(); const timer = setInterval(check, 15000); return () => { live = false; clearInterval(timer); }; }, []);

  const load = useCallback(async () => {
    try { const value = await api<CodingWorkspace>(`/interviews/${sessionId}/coding`); if (mounted.current) { adopt(value); setError(""); } }
    catch (e) { if (mounted.current) setError((e as Error).message); }
  }, [sessionId, adopt]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  const save = useCallback(async (): Promise<void> => {
    if (task.current) { await task.current; return save(); }
    const snapshot = { ...draft.current };
    if (!active || !snapshot.pid || JSON.stringify(snapshot) === saved.current) return;
    const job = async () => {
      if (mounted.current) setSaveState("Saving…");
      try {
        const value = await api<{ version: number }>(`/interviews/${sessionId}/coding`, { ...json({ version: version.current, problem_id: snapshot.pid, language: snapshot.language, source: snapshot.source }), method: "PUT" });
        version.current = value.version; saved.current = JSON.stringify(snapshot);
        if (mounted.current) { setSaveState(JSON.stringify(draft.current) === saved.current ? "All changes saved" : "Unsaved changes"); setError(""); }
      } catch (e) { if (mounted.current) { setSaveState(e instanceof ApiError && e.status === 409 ? "Save conflict" : "Not saved"); setError((e as Error).message); } throw e; }
    };
    task.current = job().finally(() => { task.current = null; });
    await task.current;
  }, [active, sessionId]);

  const flush = useCallback(async () => { await save(); await running.current; }, [save]);
  useEffect(() => { onFlush(flush); }, [flush, onFlush]);
  useEffect(() => { if (!ws || !active) return; const timer = setTimeout(() => { void save().catch(() => {}); }, 1200); return () => clearTimeout(timer); }, [source, language, ws, active, save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (JSON.stringify(draft.current) !== saved.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const change = (value: string) => { if (disabled) return; draft.current.source = value; setSource(value); setSaveState("Unsaved changes"); };
  const switchLanguage = async (next: CodeLanguage) => {
    if (!ws) return;
    setBusy(true);
    try {
      await save();
      const value = await api<CodingWorkspace>(`/interviews/${sessionId}/coding`);
      const code = value.solutions[draft.current.pid].sources[next] ?? value.starters[next];
      draft.current = { ...draft.current, source: code, language: next }; setSource(code); setLanguage(next);
      await save();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const run = async (mode: "examples" | "submit") => {
    if (running.current) return;
    setBusy(true); setError("");
    const job = async () => {
      try { await save(); const value = await api<CodingRun>(`/interviews/${sessionId}/coding/run`, json({ version: version.current, mode })); setResult(value); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); running.current = null; }
    };
    running.current = job();
    await running.current;
  };

  const advance = async (skip: boolean) => {
    if (skip && !await dialog.confirm({ title: "Skip this problem?", body: "Your saved code and test history will remain in the report. The next problem will become active.", confirmLabel: "Skip problem" })) return;
    setBusy(true);
    try { await save(); adopt(await api<CodingWorkspace>(`/interviews/${sessionId}/coding/next`, json({ version: version.current, skip }))); onAdvance(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  if (!ws) return <section className="grid h-full place-items-center rounded-2xl border border-white/10 bg-[#111827] p-5 text-sm text-white/70">{error ? <div><p role="alert">{error}</p><button className="mt-3 underline" onClick={() => void load()}>Reload workspace</button></div> : <Loader2 className="animate-spin" />}</section>;
  const problem = ws.problems[ws.active_index];
  const accepted = result?.status === "accepted" && result.mode === "submit";
  return <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#111827] shadow-2xl" aria-label="Coding interview workspace">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3"><div className="flex items-center gap-2"><Code2 size={16} className="text-[#a0bcff]" /><h2 className="text-xs font-semibold">Coding workspace</h2><span className="text-[10px] text-white/45">{ws.active_index + 1}/{ws.problems.length}</span></div><span className="text-[10px] text-white/55" role="status">{saveState}</span></header>
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2 text-xs"><button aria-pressed={tab === "problem"} onClick={() => setTab("problem")} className={tab === "problem" ? "text-[#a0bcff]" : "text-white/60"}>Problem</button><button aria-pressed={tab === "editor"} onClick={() => setTab("editor")} className={tab === "editor" ? "text-[#a0bcff]" : "text-white/60"}>Editor</button><select aria-label="Programming language" className="ml-auto rounded-md border border-white/15 bg-[#172033] px-2 py-1 text-xs text-white" value={language} onChange={(e) => void switchLanguage(e.target.value as CodeLanguage)} disabled={disabled}>{(Object.keys(ws.languages) as CodeLanguage[]).map((key) => <option key={key} value={key}>{ws.languages[key].label}</option>)}</select></div>
    <div className="shrink-0 border-b border-[#8aafff]/15 bg-[#8aafff]/5 px-4 py-2 text-[11px] leading-relaxed text-white/75"><span className="mr-2 font-semibold text-[#a0bcff]">Constraints</span>{problem.constraints}<span className="ml-2 text-white/45">2 seconds / test · 512 MB</span></div>
    {error && <div role="alert" className="border-b border-amber-400/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">{error}<button className="ml-2 underline" onClick={async () => { if (await dialog.confirm({ title: "Reload saved workspace?", body: "Download your code first if you want to keep unsaved changes. Reloading replaces them with the latest server version.", confirmLabel: "Reload" })) await load(); }}>Reload saved version</button></div>}
    <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden xl:grid-cols-[minmax(200px,.7fr)_minmax(0,1fr)]">
      <div className={`${tab === "problem" ? "block" : "hidden"} min-w-0 overflow-y-auto break-words border-r border-white/10 p-4 xl:block`} data-lenis-prevent><p className="text-[10px] font-semibold uppercase tracking-widest text-[#a0bcff]">{problem.difficulty} · {problem.test_count} tests</p><h3 className="mt-2 text-lg font-semibold tracking-tight">{problem.title}</h3><p className="mt-3 text-xs leading-relaxed text-white/75">{problem.statement}</p><h4 className="mb-1 mt-4 text-xs font-semibold">Input format</h4><p className="text-xs leading-relaxed text-white/65">{problem.input_format}</p><h4 className="mb-1 mt-4 text-xs font-semibold">Constraints</h4><p className="text-xs leading-relaxed text-white/65">{problem.constraints}</p><p className="mt-4 text-[11px] text-white/45">Write a complete program that reads stdin and writes stdout. Whitespace between output values is ignored. No packages or network access. Each test has 2 seconds; the sandbox has 512 MB of memory.</p>{problem.examples.map((example, i) => <div key={i} className="mt-4 space-y-2 rounded-lg border border-white/10 bg-black/15 p-3"><p className="text-xs font-medium">Example {i + 1} · {example.name}</p><p className="text-[10px] uppercase text-white/45">Input</p><pre className="overflow-auto whitespace-pre-wrap text-xs text-white/80">{example.input || "(empty)"}</pre><p className="text-[10px] uppercase text-white/45">Output</p><pre className="whitespace-pre-wrap text-xs text-white/80">{example.expected || "(empty)"}</pre></div>)}</div>
      <div className={`${tab === "editor" ? "flex" : "hidden"} min-h-0 min-w-0 overflow-hidden flex-col xl:flex`}><div className="flex items-center justify-between gap-2 bg-black/15 px-3 py-1.5 text-[10px] text-white/50"><span>{ws.languages[language].file}</span><div className="flex items-center gap-3"><button onClick={() => { setPlain((v) => !v); }} className="hover:text-white">{plain ? "Syntax editor" : editorReady ? "Plain editor" : "Editor loading? Use plain editor"}</button><button aria-label="Download current source" onClick={() => { const url = URL.createObjectURL(new Blob([source], { type: "text/plain" })); const a = document.createElement("a"); a.href = url; a.download = ws.languages[language].file; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={12} /></button></div></div><div className="relative min-h-[100px] min-w-0 flex-1 overflow-hidden" onPasteCapture={(e) => { if (proctored && active) { e.preventDefault(); setError("Pasting is disabled during this monitored interview. Type your implementation."); } }}>
        {plain ? <textarea aria-label="Code editor" spellCheck={false} value={source} onChange={(e) => change(e.target.value)} readOnly={disabled} maxLength={50000} className="absolute inset-0 h-full w-full resize-none bg-[#101622] p-4 font-mono text-xs leading-relaxed text-white/90 outline-none" /> : <Editor height="100%" path={`interview-${sessionId}/${problem.id}/${ws.languages[language].file}`} language={ws.languages[language].monaco} value={source} theme="vs-dark" onChange={(value) => { if ((value ?? "").length <= 50000) change(value ?? ""); }} onMount={(editor, monaco) => { setEditorReady(true); editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void save().catch(() => {}); }); }} loading={<p className="p-4 text-xs text-white/50">Loading code editor… Plain editor is available above.</p>} options={{ fontSize: 13, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, tabSize: 4, readOnly: disabled, wordWrap: "on", padding: { top: 16 }, quickSuggestions: false, suggestOnTriggerCharacters: false }} />}
      </div>{result && <div className="max-h-[35%] min-h-16 overflow-y-auto border-t border-white/10 bg-[#0d1421] px-4 py-3" data-lenis-prevent><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className={result.status === "accepted" ? "text-[#a0bcff]" : "text-white/80"}>{label(result.status)} · {result.result?.passed ?? 0}/{result.result?.total ?? "—"} · {result.mode === "submit" ? "Full suite" : "Examples only"} · {new Date(result.created_at).toLocaleTimeString()}</span>{active && <button className="flex items-center gap-1 text-[#a0bcff]" disabled={busy} onClick={async () => { try { await save(); onDiscuss("Please review my saved coding solution and latest test results. Ask me about the reasoning behind my approach."); } catch {} }}><MessageSquare size={12} /> Discuss</button>}</div><p className="mt-1 text-[10px] text-white/45">Results apply to the saved code at run time. Changes require a new run.</p>{result.result?.message && <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-amber-200">{result.result.message}</pre>}<ul className="mt-2 space-y-1 text-[11px]">{result.result?.cases.map((c, i) => <li key={i}><details><summary className="cursor-pointer text-white/65">{c.label}: {label(c.status)} · {c.duration_ms} ms</summary>{!c.hidden && <pre className="my-2 whitespace-pre-wrap rounded bg-black/20 p-2">{`Expected: ${c.expected || "(empty)"}\nOutput: ${c.output || "(empty)"}${c.stderr ? `\nError: ${c.stderr}` : ""}`}</pre>}</details></li>)}</ul></div>}</div>
    </div>
    <footer className="flex flex-wrap items-center gap-2 border-t border-white/10 px-3 py-2"><button className="rounded-lg border border-white/15 px-2 py-1.5 text-[11px] text-white/75" disabled={disabled} onClick={() => void save().catch(() => {})}><Save size={12} className="mr-1 inline" /> Save</button><button className="rounded-lg border border-white/20 px-2 py-1.5 text-[11px] text-white/85 disabled:opacity-40" disabled={disabled || !runner.ready} onClick={() => void run("examples")}>{busy ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : <Play size={12} className="mr-1 inline" />} Run examples</button><button className="rounded-lg bg-[#9ab8ff] px-3 py-1.5 text-[11px] font-semibold text-[#101f43] disabled:opacity-40" disabled={disabled || !runner.ready} onClick={() => void run("submit")}><Check size={12} className="mr-1 inline" /> Submit all tests</button>{ws.active_index + 1 < ws.problems.length && <button className="ml-auto text-[11px] text-white/70 disabled:opacity-40" disabled={disabled} onClick={() => void advance(!accepted)}>{accepted ? "Next problem" : "Skip problem"}<ChevronRight size={12} className="ml-1 inline" /></button>}{!runner.ready && <p role="status" className="text-[10px] text-amber-100">{runner.message}</p>}{!active && <p className="text-[10px] text-white/50">Interview completed · read-only</p>}</footer>
  </section>;
}
