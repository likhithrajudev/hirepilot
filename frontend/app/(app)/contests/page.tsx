"use client";

import { Plus, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/providers";
import { Badge, EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { SegControl } from "@/components/teams/parts";
import { api, ApiError, json } from "@/lib/api";
import { usePracticeProblems } from "@/lib/practice";
import { useContests, type ContestRow } from "@/lib/teams";

const KINDS = ["All", "Weekly", "Themed", "College"] as const;
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const left = (iso: string, now: number) => Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
const hms = (s: number) => [["hours", Math.floor(s / 3600)], ["minutes", Math.floor(s / 60) % 60], ["seconds", s % 60]] as const;

function Create({ onDone }: { onDone: () => void }) {
  const problems = usePracticeProblems().data?.problems ?? [];
  const toast = useToast();
  const [f, setF] = useState({ name: "", kind: "weekly", starts: "", duration: 90, penalty: 5 });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api("/contests", json({ name: f.name, kind: f.kind, starts_at: new Date(f.starts).toISOString(), duration_min: f.duration, penalty_min: f.penalty, problem_ids: picked })); toast("Contest created", "success"); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not create the contest", "error"); } finally { setBusy(false); }
  };
  return (
    <section className="card space-y-4 p-5" aria-label="New contest">
      <h2 className="font-semibold">New contest</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2"><span className="label !mb-0">Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Weekly Sprint #1" /></label>
        <label className="space-y-1"><span className="label !mb-0">Type</span><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="weekly">Weekly</option><option value="themed">Themed</option><option value="college">College</option></select></label>
        <label className="space-y-1"><span className="label !mb-0">Starts</span><input type="datetime-local" className="input" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} /></label>
        <label className="space-y-1"><span className="label !mb-0">Length (minutes)</span><input type="number" min={10} max={300} className="input" value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) })} /></label>
        <label className="space-y-1"><span className="label !mb-0">Penalty per wrong submission (minutes)</span><input type="number" min={0} max={60} className="input" value={f.penalty} onChange={(e) => setF({ ...f, penalty: Number(e.target.value) })} /></label>
      </div>
      <fieldset><legend className="label">Problems ({picked.length} picked, in order)</legend><div className="flex flex-wrap gap-2">{problems.map((p) => { const on = picked.includes(p.id); return <button key={p.id} type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== p.id) : [...picked, p.id])} className={`chip cursor-pointer border !px-3 !py-1.5 ${on ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}>{on ? `${picked.indexOf(p.id) + 1}. ` : ""}{p.title}</button>; })}</div></fieldset>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={busy || f.name.trim().length < 3 || !f.starts || !picked.length} onClick={() => void submit()}>Create contest</button><button className="btn btn-ghost" onClick={onDone}>Cancel</button></div>
    </section>
  );
}

export default function Contests() {
  const { data, isLoading, error } = useContests();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("All");
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const toggle = async (c: ContestRow) => {
    try { await api(`/contests/${c.id}/register`, { method: c.registered ? "DELETE" : "POST" }); void qc.invalidateQueries({ queryKey: ["contests"] }); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not update your registration", "error"); }
  };
  const live = data?.live[0];
  const up = (data?.upcoming ?? []).filter((u) => kind === "All" || u.kind === kind.toLowerCase());
  const empty = data && !data.live.length && !data.upcoming.length && !data.past.length;

  return (
    <div className="workspace-page space-y-6">
      <PageHeader eyebrow="Practice" title="Contests" subtitle="Timed rounds on the problem library with a live leaderboard. Most problems solved wins; ties go to the least penalty."
        actions={data?.can_create && !creating ? <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New contest</button> : undefined} />
      {error ? <ErrorNote>Could not load contests. Refresh to try again.</ErrorNote> : isLoading ? <Skeleton className="h-48" /> : (
        <>
          {creating && <Create onDone={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["contests"] }); }} />}
          {empty && !creating && <EmptyState icon={<Trophy size={22} />} title="No contests yet" body={data?.can_create ? "Create the first one: pick a start time and the problems." : "Contests will appear here when one is scheduled."} action={data?.can_create ? <button className="btn btn-primary" onClick={() => setCreating(true)}>New contest</button> : undefined} />}
          {live && (
            <section className="card flex flex-wrap items-center justify-between gap-6 p-6 sm:p-8">
              <div className="max-w-xl"><Badge tone="bad" className="gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-bad" />LIVE NOW</Badge><h2 className="mt-3 text-[28px] font-bold tracking-tight">{live.name}</h2>
                <p className="mt-1.5 text-sm text-muted">{live.problem_count} problems · {live.duration_min} minutes · {live.penalty_min} minutes of penalty per wrong submission · {live.registered_count} registered</p>
                <div className="mt-5 flex flex-wrap gap-2"><Link href={`/contests/${live.id}`} className="btn btn-primary">Enter contest</Link><Link href={`/contests/${live.id}#standings`} className="btn">Live standings</Link></div></div>
              <div><p className="eyebrow mb-2">Ends in</p><div className="flex gap-2">{hms(left(live.ends_at, now)).map(([l, v]) => <div key={l} className="w-[76px] rounded-xl border border-line bg-surface2 py-3 text-center"><p className="text-[28px] font-bold tabular-nums leading-none">{String(v).padStart(2, "0")}</p><p className="mt-1 text-[11px] text-muted">{l}</p></div>)}</div></div>
            </section>
          )}
          {!!data?.upcoming.length && (
            <section aria-labelledby="up-title" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="up-title" className="text-lg font-semibold tracking-tight">Upcoming</h2><SegControl items={KINDS} value={kind} onChange={setKind} label="Contest type" /></div>
              <div className="grid gap-3 md:grid-cols-2">{up.map((u) => (
                <article key={u.id} className="card flex items-center justify-between gap-4 p-4"><div className="min-w-0"><div className="flex items-center gap-2"><Badge tone="brand">{u.kind.toUpperCase()}</Badge><span className="text-xs text-muted">{u.registered_count} registered</span></div>
                  <Link href={`/contests/${u.id}`} className="mt-2 block truncate font-semibold hover:text-brand hover:underline">{u.name}</Link><p className="text-[13px] text-muted">{when(u.starts_at)} · {u.duration_min} min</p></div>
                  <button className={`btn btn-sm ${u.registered ? "" : "btn-primary"}`} aria-pressed={u.registered} onClick={() => void toggle(u)}>{u.registered ? "Registered" : "Register"}</button></article>))}</div>
            </section>
          )}
          {!!data?.past.length && (
            <section aria-labelledby="past-title" className="space-y-3"><h2 id="past-title" className="text-lg font-semibold tracking-tight">Past contests</h2>
              <ul className="card divide-y divide-line">{data.past.map((p) => <li key={p.id}><Link href={`/contests/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface2"><span className="font-medium">{p.name}</span><span className="text-xs text-muted">{when(p.starts_at)} · {p.registered_count} took part</span></Link></li>)}</ul></section>
          )}
        </>
      )}
    </div>
  );
}
