"use client";

import { Check, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, ErrorNote, Skeleton } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { DIFF_TONE } from "@/lib/practice";
import { useContest, useStandings } from "@/lib/teams";

const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export default function ContestPage() {
  const id = Number(useParams<{ id: string }>().id) || 0;
  const { data: c, error } = useContest(id);
  const st = useStandings(id, c?.state === "live");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (error) return <div className="workspace-page"><ErrorNote>{error instanceof ApiError && error.status === 404 ? "That contest does not exist." : "Could not load the contest."}</ErrorNote></div>;
  if (!c) return <div className="workspace-page space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  const target = c.state === "upcoming" ? c.starts_at : c.ends_at;
  const secs = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
  const parts = [["hours", Math.floor(secs / 3600)], ["minutes", Math.floor(secs / 60) % 60], ["seconds", secs % 60]] as const;
  return (
    <div className="workspace-page space-y-6">
      <Link href="/contests" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft size={14} /> Contests</Link>
      <section className="card flex flex-wrap items-center justify-between gap-6 p-6">
        <div><Badge tone={c.state === "live" ? "bad" : c.state === "upcoming" ? "brand" : "neutral"}>{c.state === "live" ? "LIVE NOW" : c.state === "upcoming" ? "UPCOMING" : "ENDED"}</Badge><h1 className="mt-3 text-[28px] font-bold tracking-tight">{c.name}</h1>
          <p className="mt-1 text-sm text-muted">{c.problem_count} problems · {c.duration_min} minutes · {c.penalty_min} minutes of penalty per wrong submission · {c.registered_count} registered</p></div>
        {c.state !== "ended" && <div><p className="eyebrow mb-2">{c.state === "upcoming" ? "Starts in" : "Ends in"}</p><div className="flex gap-2">{parts.map(([l, v]) => <div key={l} className="w-[76px] rounded-xl border border-line bg-surface2 py-3 text-center"><p className="text-[28px] font-bold tabular-nums leading-none">{String(v).padStart(2, "0")}</p><p className="mt-1 text-[11px] text-muted">{l}</p></div>)}</div></div>}
      </section>
      <section aria-labelledby="problems-title" className="space-y-3"><h2 id="problems-title" className="text-lg font-semibold tracking-tight">Problems</h2>
        {c.state === "upcoming" ? <p className="card p-5 text-sm text-muted">The problems are revealed when the contest starts. Register on the contests page to get your place.</p> : (
          <ul className="grid gap-3 md:grid-cols-2">{c.problems.map((p, i) => (
            <li key={p.id}><Link href={c.state === "live" ? `/practice/${p.id}?contest=${c.id}` : `/practice/${p.id}`} className="card card-hover flex items-center gap-3 p-4">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface2 text-sm font-bold">{String.fromCharCode(65 + i)}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{p.title}</span><span className="text-xs text-muted">{p.points} points</span></span>
              <Badge tone={DIFF_TONE[p.difficulty]} className="capitalize">{p.difficulty}</Badge>{p.status === "solved" && <span className="grid h-6 w-6 place-items-center rounded-full bg-ok-soft text-ok" title="Solved"><Check size={13} /><span className="sr-only">Solved</span></span>}</Link></li>))}</ul>)}
      </section>
      <section id="standings" aria-labelledby="board-title" className="card portal-table">
        <div className="p-5"><h2 id="board-title" className="text-lg font-semibold tracking-tight">Standings</h2><p className="text-xs text-muted">{c.state === "live" ? "Updates every 15 seconds" : "Final"}</p></div>
        {c.state === "upcoming" ? <p className="px-5 pb-5 text-sm text-muted">Standings appear once the contest starts.</p> : !st.data?.rows.length ? <p className="px-5 pb-5 text-sm text-muted">No accepted or attempted submissions yet.</p> : (
          <table><caption className="sr-only">Contest standings</caption><thead><tr><th scope="col">Rank</th><th scope="col">Coder</th>{st.data.problems.map((p) => <th key={p.id} scope="col">{p.label}</th>)}<th scope="col">Score</th><th scope="col">Penalty</th></tr></thead>
            <tbody>{st.data.rows.map((r) => <tr key={r.rank} className={r.you ? "bg-brand-soft" : ""}><td className={`tabular-nums font-semibold ${r.rank <= 3 ? "text-brand" : ""}`}>{r.rank}</td><td className="font-semibold">{r.you ? "You" : r.name}</td>
              {r.cells.map((cell, i) => <td key={i} className="font-mono text-xs">{!cell ? <span className="text-subtle">—</span> : cell.minute !== null ? <span className="rounded bg-ok-soft px-1.5 py-0.5 text-ok">{fmt(cell.minute)}{cell.wrong ? ` (+${cell.wrong})` : ""}</span> : <span className="rounded bg-bad-soft px-1.5 py-0.5 text-bad">-{cell.wrong}</span>}</td>)}
              <td className="tabular-nums font-semibold">{r.score}</td><td className="tabular-nums text-muted">{r.penalty}</td></tr>)}</tbody></table>)}
      </section>
    </div>
  );
}
