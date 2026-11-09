"use client";

import { ArrowRight, ArrowUpRight, Briefcase, Check, CheckCircle2, FileText, KeyRound, Mic, Search, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { CompanyLogo, CountUp, ErrorNote, ScoreRing, Skeleton, timeAgo } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useJobs, useResumes, useSettings } from "@/lib/hooks";

export default function Home() {
  const { user } = useAuth();
  const first = user?.name?.split(" ")[0] ?? "";
  const settings = useSettings();
  const resumes = useResumes();
  const jobs = useJobs({ sort: "score" });
  const applied = useJobs({ status: "applied" });
  const loading = settings.isPending || resumes.isPending || jobs.isPending;
  const setupError = settings.isError || resumes.isError || jobs.isError;
  const steps = [
    { done: !!settings.data?.openai_configured, icon: KeyRound, title: "Connect your AI", body: "Add your OpenAI key in Settings.", href: "/settings?section=ai", cta: "Connect AI" },
    { done: !!resumes.data?.length, icon: FileText, title: "Build your starting point", body: "Bring your LaTeX resume or choose a template.", href: "/resumes", cta: "Add a resume" },
    { done: !!jobs.data?.length, icon: Search, title: "Find your next opportunity", body: "Scan career sites for roles that fit your goals.", href: "/jobs", cta: "Explore opportunities" },
  ];
  const completed = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const top = (jobs.data ?? []).filter((j) => j.score !== null).slice(0, 4);
  const metrics = [
    { label: "Master resumes", value: resumes.data?.length, error: resumes.isError, icon: FileText, href: "/resumes" },
    { label: "Tailored versions", value: resumes.data?.reduce((n, r) => n + r.version_count, 0), error: resumes.isError, icon: Sparkles, href: "/resumes" },
    { label: "Loaded opportunities", value: jobs.data?.length, error: jobs.isError, icon: Briefcase, href: "/jobs" },
    { label: "Loaded applications", value: applied.data?.length, error: applied.isError, icon: CheckCircle2, href: "/jobs?status=applied" },
  ];

  return (
    <div className="workspace-page space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow mb-2">A little preparation. A lot of possibility.</p>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-1px] sm:text-[32px]">Let’s move you forward{first ? `, ${first}` : ""}.</h1>
          <p className="mt-2 text-sm text-muted">Your opportunities, preparation, and next steps. All in one place.</p>
        </div>
        <Link href="/jobs" className="btn"><Search size={15} /> Find opportunities</Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)]">
        <section className="workspace-rail relative overflow-hidden rounded-xl p-6 sm:p-8">
          <div aria-hidden="true" className="absolute -right-10 -top-12 h-64 w-64 rounded-full border-[40px] border-white/[0.035]" />
          <div className="relative flex h-full flex-col items-start">
            <span className="mb-6 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-brand"><span className="h-1.5 w-1.5 rounded-full bg-brand" /> Your next move</span>
            {loading ? <div className="w-full space-y-3"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-4 w-2/3" /></div> : <>
              <h2 className="max-w-md text-[26px] font-semibold leading-tight tracking-[-.7px] sm:text-[30px]">{setupError ? "Your next chapter starts here." : next ? next.title : "You’ve got the skills.\nLet’s find your fit."}</h2>
              <p className="mb-7 mt-3 max-w-md text-sm leading-relaxed text-muted">{setupError ? "Explore roles, prepare your resume, and build confidence for the conversation ahead." : next ? next.body : "Discover a role, understand your match, and prepare an application that tells your story."}</p>
              <Link href={setupError ? "/jobs" : next?.href ?? "/jobs"} className="btn btn-primary mt-auto">{setupError ? "Explore opportunities" : next?.cta ?? "Explore opportunities"} <ArrowUpRight size={16} /></Link>
            </>}
          </div>
        </section>
        <section className="card flex flex-col p-6">
          <div className="flex items-center justify-between"><span className="eyebrow">Practice with purpose</span><Mic size={18} className="text-brand" /></div>
          <h2 className="mt-5 text-xl font-semibold tracking-tight">Make your next interview<br />feel like familiar ground.</h2>
          <p className="mb-6 mt-3 text-sm leading-relaxed text-muted">Technical, behavioral, or a deep dive into your resume. Get feedback you can act on.</p>
          <Link href="/interviews" className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-brand">Set up a practice session <ArrowRight size={15} /></Link>
        </section>
      </div>

      <section aria-label="Workspace activity" className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface md:grid-cols-4">
        {metrics.map(({ label, value, error, icon: Icon, href }, i) => <Link key={label} href={href} className={`group p-5 transition-colors hover:bg-surface2 ${i > 0 ? "border-l border-line" : ""} ${i > 1 ? "border-t md:border-t-0" : ""}`}>
          <div className="flex items-center justify-between"><Icon size={16} className="text-subtle" /><ArrowUpRight size={13} className="text-subtle transition-colors group-hover:text-brand" /></div>
          {value !== undefined ? <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight"><CountUp value={value} /></p> : error ? <p className="mt-4 text-sm text-bad">Unavailable</p> : <Skeleton className="mt-4 h-[30px] w-12" />}
          <p className="mt-2 text-xs text-muted">{label}</p>
        </Link>)}
      </section>

      {setupError && <ErrorNote>Some workspace information could not be loaded. <button className="ml-1 font-semibold underline" onClick={() => { void settings.refetch(); void resumes.refetch(); void jobs.refetch(); }}>Try again</button></ErrorNote>}
      {applied.isError && <ErrorNote>Applications could not be loaded. <button className="font-semibold underline" onClick={() => void applied.refetch()}>Retry applications</button></ErrorNote>}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)]">
        <section>
          <div className="mb-4 flex items-center justify-between"><div><p className="eyebrow mb-1">Opportunity radar</p><h2 className="text-lg font-semibold tracking-tight">Roles worth a closer look</h2></div><Link href="/jobs" className="inline-flex items-center gap-1 text-xs font-semibold text-brand">View all <ArrowRight size={13} /></Link></div>
          {jobs.isPending ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div> : jobs.isError && !jobs.data ? <div className="card p-6 text-sm text-muted">Your matches will appear when the connection is restored.</div> : top.length ? <ul className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
            {top.map((j) => <li key={j.id}><Link href="/jobs" className="flex items-center gap-3.5 p-5 transition hover:bg-surface2"><CompanyLogo name={j.company} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{j.title}</p><p className="mt-1 truncate text-xs text-muted">{j.company}{j.location && ` · ${j.location}`}</p></div><ScoreRing score={j.score} /></Link></li>)}
          </ul> : <div className="rounded-xl border border-dashed border-line2 bg-surface p-8 sm:p-10"><Target size={28} strokeWidth={1.5} className="mb-5 text-brand" /><h3 className="text-base font-semibold">Your next role is out there.</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">Find jobs, then review them against your resume. Your strongest matches will appear here.</p><Link href="/jobs" className="btn mt-5">Find your first matches <ArrowRight size={14} /></Link></div>}
          {!!resumes.data?.length && <div className="mt-7"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Pick up where you left off</h2><Link href="/resumes" className="text-xs text-brand">Resume studio</Link></div><ul className="divide-y divide-line">{resumes.data.slice(0, 3).map((r) => <li key={r.id}><Link href={`/resumes/${r.id}`} className="flex items-center gap-3 py-3 text-sm hover:text-brand"><FileText size={16} className="text-subtle" /><span className="min-w-0 flex-1 truncate font-medium">{r.name}</span><span className="text-xs text-subtle">{timeAgo(r.updated_at)}</span><ArrowUpRight size={14} /></Link></li>)}</ul></div>}
        </section>
        <section className="self-start rounded-xl border border-line bg-surface p-6">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Your launch checklist</h2><span className="font-mono text-xs text-muted">{loading || setupError ? "—" : `${completed}/3`}</span></div>
          <div className="mb-6 mt-4 flex gap-1.5" aria-hidden="true">{steps.map((s) => <span key={s.title} className={`h-1 flex-1 rounded-full ${s.done ? "bg-brand" : "bg-line"}`} />)}</div>
          <ol className="space-y-6">{steps.map((s, i) => <li key={s.title}><Link href={s.href} className="group flex gap-3"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] ${s.done ? "border-brand bg-brand-soft text-brand" : "border-line2 text-muted"}`}>{s.done ? <Check size={13} /> : `0${i + 1}`}</span><span><span className="block text-[13px] font-semibold group-hover:text-brand">{s.title}</span><span className="mt-1 block text-xs leading-relaxed text-muted">{s.body}</span></span></Link></li>)}</ol>
          <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-subtle">One step at a time. You decide where to apply; HirePilot helps you prepare.</p>
        </section>
      </div>
    </div>
  );
}
