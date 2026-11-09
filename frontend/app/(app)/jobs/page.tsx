"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bookmark, CheckCircle2, ExternalLink, EyeOff, Loader2, MapPin, RefreshCw, Rocket, Search, SearchX, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/app/providers";
import ApplyDialog from "@/components/ApplyDialog";
import LocationBar from "@/components/LocationBar";
import ManagerTake from "@/components/ManagerTake";
import { CompanyLogo, EmptyState, ErrorNote, PageHeader, ScoreRing, Skeleton, timeAgo } from "@/components/ui";
import { usePrefs } from "@/lib/prefs";
import { useJobs, useRefreshJobs, useRefreshStatus, useResumes, useScoreJobs, useSetJobStatus } from "@/lib/hooks";
import { useLocations } from "@/lib/location";
import type { Job, JobFilters, JobStatus, LevelTag } from "@/lib/types";

const LEVEL: Record<LevelTag, { label: string; cls: string }> = {
  intern: { label: "Intern", cls: "bg-warn-soft text-warn" },
  new_grad: { label: "New grad", cls: "bg-brand-soft text-brand" },
  junior: { label: "Junior", cls: "bg-ok-soft text-ok" },
  other: { label: "Other", cls: "bg-surface2 text-muted" },
};
const STATUS_TABS: { v: JobStatus | ""; label: string }[] = [
  { v: "", label: "Active" }, { v: "saved", label: "Saved" }, { v: "applied", label: "Applied" }, { v: "ignored", label: "Ignored" },
];

export default function Page() {
  return <Suspense fallback={null}><JobsPage /></Suspense>;
}

function JobsPage() {
  const toast = useToast();
  const loc = useLocations();
  const { prefs, ready: prefsReady } = usePrefs();
  const sp = useSearchParams();
  const [filters, setFilters] = useState<JobFilters>(() => ({ sort: "score", level: "", status: STATUS_TABS.find((t) => t.v === sp.get("status"))?.v ?? "" }));
  const [search, setSearch] = useState("");
  const [roles, setRoles] = useState("backend, software engineer, platform");
  const [resumeId, setResumeId] = useState<number | null>(null);
  const [showScan, setShowScan] = useState(false);
  const [applyJob, setApplyJob] = useState<Job | null>(null);

  const locationFilter = useMemo(() => loc.selected.join(","), [loc.selected]);
  const queryFilters = useMemo(
    () => ({ ...filters, location: locationFilter || undefined, exclude: prefs.blocked_companies.join(",") || undefined, hide_below: prefs.default_min_score || undefined }),
    [filters, locationFilter, prefs.blocked_companies, prefs.default_min_score],
  );

  const resumes = useResumes();
  const jobs = useJobs(queryFilters);
  const refresh = useRefreshJobs();
  const status = useRefreshStatus(refresh.isPending);
  const score = useScoreJobs();
  const setStatus = useSetJobStatus();

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: search || undefined })), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const saved = Number(localStorage.getItem("hp_job_resume"));
    const list = resumes.data ?? [];
    if (list.length && resumeId === null) setResumeId(list.some((r) => r.id === saved) ? saved : list[0].id);
  }, [resumes.data, resumeId]);

  const running = status.data?.running ?? false;
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (wasRunning && !running) {
      jobs.refetch();
      toast(`Scan finished: ${status.data?.added ?? 0} new roles`, "success");
    }
    setWasRunning(running);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const scan = () =>
    refresh.mutate(
      { roles: csv(roles), locations: loc.selected, include_internships: prefs.include_internships, include_all_levels: false },
      { onError: (e) => toast(e.message, "error") },
    );
  // Saved default role keywords, applied once preferences have loaded.
  const rolesInit = useRef(false);
  useEffect(() => { if (prefsReady && !rolesInit.current) { rolesInit.current = true; setRoles(prefs.default_roles); } }, [prefsReady, prefs.default_roles]);
  // Opened from the command palette ("Find new jobs"): start a scan once, then clean the URL.
  const scanned = useRef(false);
  useEffect(() => {
    if (sp.get("scan") && prefsReady && loc.ready && !scanned.current && !running) { scanned.current = true; scan(); window.history.replaceState(null, "", "/jobs"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, prefsReady, loc.ready]);
  const st = status.data;
  const pct = st && st.boards_total ? Math.round((st.boards_done / st.boards_total) * 100) : 0;

  return (
    <div className="workspace-page space-y-6">
      <PageHeader
        eyebrow="Discover / Opportunities"
        title="Find your next chapter"
        subtitle="Discover early-career roles. Get a clear view of your fit, then build an application with purpose."
        actions={
          <>
            <button className="btn" onClick={() => setShowScan((s) => !s)} aria-expanded={showScan}>Role keywords</button>
            <button className="btn btn-primary" disabled={running || refresh.isPending} onClick={scan}>
              {running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {running ? "Scanning…" : "Find jobs"}
            </button>
          </>
        }
      />

      <div className="rounded-xl border border-line bg-surface p-4"><p className="eyebrow mb-3">Where do you want to go?</p><LocationBar loc={loc} /></div>

      <AnimatePresence initial={false}>
        {showScan && (
          <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="card overflow-hidden">
            <div className="p-4">
              <label className="label" htmlFor="roles">Role keywords (comma separated)</label>
              <input id="roles" className="input" value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="backend, platform, infra" />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {running && st && (
        <div className="card pop space-y-2 p-4">
          <div className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 font-medium"><Loader2 size={14} className="animate-spin text-brand" /> Scanning company career sites</span>
            <span className="tabular-nums text-muted">{st.boards_done}/{st.boards_total}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {!running && st?.finished_at && (
        <p className="text-xs text-subtle">
          Last scan {timeAgo(st.finished_at)}: {st.found} early-career matches, {st.added} new.
          {st.boards_failed.length > 0 && ` ${st.boards_failed.length} site${st.boards_failed.length > 1 ? "s" : ""} did not respond.`}
          {st.error && <span className="text-bad"> Error: {st.error}</span>}
        </p>
      )}

      <div className="workspace-toolbar sticky top-16 z-30 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input className="input !pl-9" placeholder="Search title, company…" aria-label="Search jobs" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="seg" role="group" aria-label="Status">
          {STATUS_TABS.map((t) => <button key={t.label} aria-pressed={(filters.status ?? "") === t.v} onClick={() => setFilters({ ...filters, status: t.v })}>{t.label}</button>)}
        </div>
        <select className="input !w-auto" aria-label="Level" value={filters.level ?? ""} onChange={(e) => setFilters({ ...filters, level: e.target.value as LevelTag | "" })}>
          <option value="">All levels</option>
          {(["intern", "new_grad", "junior"] as LevelTag[]).map((l) => <option key={l} value={l}>{LEVEL[l].label}</option>)}
        </select>
        <select className="input !w-auto" aria-label="Sort" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as JobFilters["sort"] })}>
          <option value="score">Best match</option><option value="recent">Most recent</option><option value="company">Company A–Z</option>
        </select>
        <div className="flex w-full flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="mr-auto text-xs text-muted">Review roles against your resume</span>
          <select className="input !w-40" aria-label="Resume used for scoring" value={resumeId ?? ""} onChange={(e) => { setResumeId(Number(e.target.value)); localStorage.setItem("hp_job_resume", e.target.value); }}>
            {resumes.data?.length === 0 && <option value="">No resumes</option>}
            {resumes.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button
            className="btn" disabled={score.isPending || resumeId === null}
            onClick={() => resumeId !== null && score.mutate({ resume_id: resumeId, limit: 20 }, { onSuccess: (d) => toast(`Reviewed ${d.scored} roles as a hiring manager would`), onError: (e) => toast(e.message, "error") })}
          >
            {score.isPending ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {score.isPending ? "Reviewing…" : "Review top 20"}
          </button>
        </div>
      </div>

      {jobs.error && <ErrorNote>{jobs.error.message}</ErrorNote>}
      <p className="text-xs text-subtle" aria-live="polite">{jobs.data ? `${jobs.data.length} role${jobs.data.length === 1 ? "" : "s"}${loc.selected.length ? ` in ${loc.selected.join(", ")}` : ""}` : " "}</p>
      {jobs.isLoading && <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[120px] w-full" />)}</div>}

      {jobs.data?.length === 0 && !jobs.isLoading && (
        filters.q || filters.level || filters.status || loc.selected.length ? (
          <EmptyState
            icon={<SearchX size={22} />} title="Nothing matches yet"
            body={loc.selected.length ? `No saved roles in ${loc.selected.join(", ")}. Run a scan to pull the latest, or widen the places above.` : "Try clearing the search or switching back to all levels."}
            action={<button className="btn btn-primary" disabled={running} onClick={scan}><RefreshCw size={15} /> Find jobs{loc.selected.length ? ` in ${loc.selected[0]}` : ""}</button>}
          />
        ) : (
          <EmptyState icon={<Search size={22} />} title="No roles yet" body="Scan 250+ company career sites for the latest new-grad, junior and intern openings."
            action={<button className="btn btn-primary" onClick={scan}><RefreshCw size={15} /> Find jobs</button>} />
        )
      )}

      <ul className="space-y-3">
        {jobs.data?.map((j, i) => (
          <JobRow key={j.id} job={j} i={i} resumeId={resumeId} onApply={() => setApplyJob(j)} pending={setStatus.isPending && setStatus.variables?.id === j.id} onStatus={(s) => setStatus.mutate({ id: j.id, status: s }, { onError: (e) => toast(e.message, "error") })} />
        ))}
      </ul>

      <ApplyDialog job={applyJob} open={!!applyJob} onClose={() => setApplyJob(null)} onApplied={() => applyJob && setStatus.mutate({ id: applyJob.id, status: "applied" })} />
    </div>
  );
}

function JobRow({ job: j, i, resumeId, pending, onStatus, onApply }: { job: Job; i: number; pending: boolean; resumeId: number | null; onStatus: (s: JobStatus) => void; onApply: () => void }) {
  const lvl = LEVEL[j.level_tag];
  const toggle = (s: JobStatus) => onStatus(j.status === s ? "new" : s);
  return (
    <li aria-busy={pending} className={`card card-hover group p-5 ${j.status === "ignored" ? "opacity-60" : ""}`}>
      <div className="flex gap-4">
        <CompanyLogo name={j.company} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <a href={j.url} target="_blank" rel="noreferrer" className="text-[15px] font-semibold leading-snug hover:text-brand hover:underline">{j.title}</a>
            <span className={`chip ${lvl.cls}`}>{lvl.label}</span>
            {j.status === "applied" && <span className="chip bg-ok-soft text-ok"><CheckCircle2 size={11} /> Applied</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
            <span className="font-semibold text-fg">{j.company}</span>
            {j.location && <span className="flex items-center gap-1"><MapPin size={12} /> {j.location}</span>}
            {j.posted_at && <span className="text-muted">{timeAgo(j.posted_at)}</span>}
          </div>
          {j.score_detail ? <ManagerTake d={j.score_detail} /> : j.score_reason && <p className="mt-2.5 rounded-md bg-surface2 px-3 py-2 text-[13px] leading-relaxed text-muted">{j.score_reason}</p>}
        </div>
        <ScoreRing score={j.score} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <button className="btn btn-primary btn-sm" onClick={onApply}><Rocket size={12} /> Apply</button>
        {resumeId !== null && <Link className="btn btn-sm" href={`/resumes/${resumeId}?job=${j.id}`}><Sparkles size={12} /> Tailor resume</Link>}
        <a className="btn btn-sm" href={j.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Posting</a>
        <span className="mx-1 h-4 w-px bg-line" />
        <button disabled={pending} className={`btn btn-sm btn-ghost ${j.status === "saved" ? "!bg-brand-soft !text-brand" : ""}`} aria-pressed={j.status === "saved"} onClick={() => toggle("saved")}>
          <Bookmark size={12} fill={j.status === "saved" ? "currentColor" : "none"} /> {j.status === "saved" ? "Saved" : "Save"}
        </button>
        <button disabled={pending} className={`btn btn-sm btn-ghost ${j.status === "applied" ? "!bg-ok-soft !text-ok" : ""}`} aria-pressed={j.status === "applied"} onClick={() => toggle("applied")}>
          <CheckCircle2 size={12} /> {j.status === "applied" ? "Applied" : "Mark applied"}
        </button>
        <button disabled={pending} className={`btn btn-sm btn-ghost ${j.status === "ignored" ? "!bg-surface2" : ""}`} aria-pressed={j.status === "ignored"} onClick={() => toggle("ignored")}>
          <EyeOff size={12} /> {j.status === "ignored" ? "Ignored" : "Ignore"}
        </button>
      </div>
    </li>
  );
}
