"use client";

import { Check, Code2, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader, ErrorNote, Skeleton, Badge } from "@/components/ui";
import { SegControl } from "@/components/teams/parts";
import { DIFF_TONE, usePracticeProblems, type Difficulty } from "@/lib/practice";

const LEVELS = ["All", "Easy", "Medium", "Hard"] as const;

export default function Practice() {
  const { data, isLoading, error } = usePracticeProblems();
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("All");
  const [topic, setTopic] = useState("");
  const rows = data?.problems ?? [];
  const topics = useMemo(() => [...rows.reduce((m, r) => m.set(r.topic, (m.get(r.topic) ?? 0) + 1), new Map<string, number>())], [rows]);
  const shown = rows.filter((r) => (level === "All" || r.difficulty === level.toLowerCase()) && (!topic || r.topic === topic) && (!q.trim() || `${r.title} ${r.topic}`.toLowerCase().includes(q.trim().toLowerCase())));
  const p = data?.progress;

  return (
    <div className="workspace-page space-y-6">
      <PageHeader eyebrow="Practice" title="Problem library" subtitle={`${rows.length || "The"} reviewed coding challenges, each with hidden tests. Run against the examples, then submit to check every case.`}
        actions={<Link href="/interviews" className="btn"><Code2 size={15} /> Try a coding interview</Link>} />
      {error ? <ErrorNote>Could not load the problems. Refresh to try again.</ErrorNote> : (
        <div className="practice-grid">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative min-w-[220px] flex-1"><span className="sr-only">Search problems</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
                <input className="input !pl-9" placeholder="Search by title or topic" value={q} onChange={(e) => setQ(e.target.value)} /></label>
              <SegControl items={LEVELS} value={level} onChange={setLevel} label="Difficulty" />
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Topics">
              {topics.map(([name, n]) => <button key={name} type="button" aria-pressed={topic === name} onClick={() => setTopic(topic === name ? "" : name)} className={`chip cursor-pointer border ${topic === name ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-muted hover:text-fg"}`}>{name} <span className="opacity-70">{n}</span></button>)}
            </div>
            <section className="card portal-table" aria-label="Problems">
              {isLoading ? <div className="space-y-2 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
                <table>
                  <caption className="sr-only">Coding problems</caption>
                  <thead><tr><th scope="col">Status</th><th scope="col">Title</th><th scope="col">Topic</th><th scope="col">Difficulty</th><th scope="col">Tests</th><th scope="col">Points</th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id}>
                        <td>{r.status === "solved" ? <span className="grid h-5 w-5 place-items-center rounded-full bg-ok-soft text-ok" title="Solved"><Check size={12} /><span className="sr-only">Solved</span></span> : r.status === "tried" ? <span className="block h-2.5 w-2.5 rounded-full bg-warn" title="Attempted"><span className="sr-only">Attempted</span></span> : <span className="sr-only">Not started</span>}</td>
                        <td><Link href={`/practice/${r.id}`} className="font-semibold text-fg hover:text-brand hover:underline">{r.title}</Link></td>
                        <td className="text-muted">{r.topic}</td>
                        <td><Badge tone={DIFF_TONE[r.difficulty]} className="capitalize">{r.difficulty}</Badge></td>
                        <td className="tabular-nums text-muted">{r.case_count}</td>
                        <td className="tabular-nums font-semibold">{r.points}</td>
                      </tr>
                    ))}
                    {!shown.length && <tr><td colSpan={6} className="py-10 text-center text-muted">No problems match. Clear a filter to see more.</td></tr>}
                  </tbody>
                </table>
              )}
              <p className="border-t border-line px-5 py-3 text-xs text-muted">Showing {shown.length} of {rows.length}</p>
            </section>
          </div>
          <aside className="practice-aside space-y-4">
            <section className="card p-5">
              <h2 className="text-sm font-semibold">Your progress</h2>
              <p className="mt-1 text-sm text-muted">{p ? `${p.solved} solved of ${p.total}` : "Loading…"}</p>
              <div className="mt-4 space-y-3">
                {(["easy", "medium", "hard"] as Difficulty[]).map((d) => { const v = p?.by_difficulty[d]; const pct = v && v.total ? Math.round((v.solved / v.total) * 100) : 0; return (
                  <div key={d}><div className="flex justify-between text-xs"><span className="capitalize">{d}</span><span className="tabular-nums text-muted">{v ? `${v.solved} / ${v.total}` : ""}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-label={`${d} solved`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div className={`h-full rounded-full ${d === "easy" ? "bg-ok" : d === "medium" ? "bg-warn" : "bg-bad"}`} style={{ width: `${pct}%` }} /></div></div>
                ); })}
              </div>
            </section>
            <section className="card p-5">
              <p className="eyebrow">Where to start</p>
              <h2 className="mt-2 text-sm font-semibold">Work up from easy</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">Solve the easy ones to warm up, then try a coding interview to practise explaining your approach out loud.</p>
              <button className="btn btn-primary mt-4" onClick={() => { setLevel("Easy"); setTopic(""); }}>Show easy problems</button>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
