"use client";

import { useEffect, useState } from "react";
import { Code2 } from "lucide-react";
import { api } from "@/lib/api";
import type { CodingWorkspace } from "@/lib/coding";
import { dateTime } from "@/lib/portal";

export default function CodingReview({ sessionId }: { sessionId: number }) {
  const [ws, setWs] = useState<CodingWorkspace | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; api<CodingWorkspace>(`/interviews/${sessionId}/coding`).then((data) => { if (live) setWs(data); }).catch(() => { if (live) setError("Could not load coding artifacts. Refresh to try again."); }); return () => { live = false; }; }, [sessionId]);
  return <section className="card space-y-5 p-5"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><Code2 size={16} className="text-brand" /> Coding evidence</h2><p className="mt-1 text-xs text-muted">Saved implementations and timestamped execution results. Tests demonstrate the cases checked; they do not prove complexity or complete correctness.</p></div>{error && <p role="alert" className="text-xs text-bad">{error}</p>}{!ws && !error && <p className="text-xs text-muted">Loading saved code…</p>}{ws?.problems.map((problem, index) => { const solution = ws.solutions[problem.id]; const runs = ws.runs.filter((run) => run.problem_id === problem.id); return <article key={problem.id} className="space-y-3 border-t border-line pt-4"><h3 className="text-sm font-semibold">{index + 1}. {problem.title} <span className="font-normal text-muted">· {problem.difficulty}</span></h3><p className="text-xs leading-relaxed text-muted">{problem.statement}</p>{Object.entries(solution.sources).map(([language, source]) => <details key={language} className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-xs font-medium">Saved {ws.languages[language as keyof typeof ws.languages].label} implementation</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed" data-lenis-prevent>{source}</pre></details>)}{runs.length ? <div className="portal-table"><table><thead><tr><th>Run time</th><th>Language</th><th>Suite</th><th>Result</th><th>Passed</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{dateTime(run.created_at)}</td><td>{ws.languages[run.language].label}</td><td>{run.mode === "submit" ? "Full suite" : "Examples"}</td><td>{run.status.replaceAll("_", " ")}</td><td>{run.result?.passed ?? 0}/{run.result?.total ?? "—"}</td></tr>)}</tbody></table></div> : <p className="text-xs text-muted">No execution results were saved for this problem.</p>}</article>; })}</section>;
}
