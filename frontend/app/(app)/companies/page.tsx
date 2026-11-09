"use client";

import { motion } from "motion/react";
import { ExternalLink, Radar, Search, SearchX } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useToast } from "@/app/providers";
import Pagination from "@/components/Pagination";
import { CompanyLogo, EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { useCompanyPage, useRefreshJobs } from "@/lib/hooks";
import { useLocations } from "@/lib/location";

const ATS_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", smartrecruiters: "SmartRecruiters",
  workday: "Workday", amazon: "Direct", microsoft: "Direct", eightfold: "Direct",
};

/** Filter pills need distinct names: three direct integrations all read "Direct" on the cards. */
const FILTER_LABEL: Record<string, string> = { amazon: "Amazon", microsoft: "Microsoft", eightfold: "Eightfold" };

export default function Page() {
  return <Suspense fallback={null}><Companies /></Suspense>;
}

function Companies() {
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const loc = useLocations();
  const refresh = useRefreshJobs();

  // All view state lives in the URL, so reload, back/forward and shared links land on the same page.
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = [12, 24, 48, 96].includes(Number(sp.get("size"))) ? Number(sp.get("size")) : 24;
  const ats = sp.get("ats") ?? "";
  const sort = sp.get("sort") === "jobs" ? "jobs" : "name";
  const qParam = sp.get("q") ?? "";
  const [q, setQ] = useState(qParam);
  const set = (patch: Record<string, string | number | null>, resetPage = true) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v === null || v === "" ? n.delete(k) : n.set(k, String(v)));
    if (resetPage) n.delete("page");
    router.replace(`/companies${n.toString() ? `?${n}` : ""}`, { scroll: false });
  };
  useEffect(() => {
    const t = setTimeout(() => q !== qParam && set({ q }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useCompanyPage({ q: qParam, ats, sort, page, pageSize });
  const total = data?.sources.reduce((n, s) => n + s.count, 0);

  return (
    <div className="workspace-page space-y-6">
      <PageHeader eyebrow="Discover / Companies" title="Go straight to the source" subtitle={`${total ?? "250+"} career sites checked directly. Open a company's own careers page, or scan just that company${loc.selected.length ? ` in ${loc.selected.join(", ")}` : ""}.`} />

      <div className="workspace-toolbar sticky top-16 z-30 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input className="input !pl-9" placeholder="Search companies…" aria-label="Search companies" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="seg" role="group" aria-label="Source">
          <button aria-pressed={ats === ""} onClick={() => set({ ats: null })}>All</button>
          {data?.sources.map((s) => <button key={s.ats} aria-pressed={ats === s.ats} onClick={() => set({ ats: s.ats })}>{FILTER_LABEL[s.ats] ?? ATS_LABEL[s.ats] ?? s.ats} <span className="ml-1 text-muted">{s.count}</span></button>)}
        </div>
        <select className="input !w-auto" aria-label="Sort" value={sort} onChange={(e) => set({ sort: e.target.value === "name" ? null : e.target.value })}>
          <option value="name">Name A–Z</option><option value="jobs">Most saved jobs</option>
        </select>
      </div>

      {error && <ErrorNote>{error.message} <button className="font-semibold underline" onClick={() => void refetch()}>Try again</button></ErrorNote>}
      {isFetching && !isLoading && <p role="status" className="text-xs text-muted">Updating companies…</p>}
      {isLoading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-[84px]" />)}</div>}
      {data && data.items.length === 0 && <EmptyState icon={<SearchX size={22} />} title="No companies match" body="Try a different name or source." />}

      <ul className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${isPlaceholderData && isFetching ? "opacity-60" : ""}`}>
        {data?.items.map((c, i) => (
          <motion.li key={`${page}-${c.name}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: Math.min(i, 11) * 0.02 }} className="card card-hover flex flex-wrap items-center gap-3.5 p-5">
            <CompanyLogo name={c.name} size={46} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{c.name}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-subtle"><span>{ATS_LABEL[c.ats] ?? c.ats}</span>{c.jobs > 0 && <span className="chip bg-brand-soft text-brand">{c.jobs} saved</span>}</div>
            </div>
            <a className="btn btn-sm btn-icon" href={c.careers_url} target="_blank" rel="noreferrer" title={`${c.name} careers page`} aria-label={`${c.name} careers page`}><ExternalLink size={13} /></a>
            <button
              className="btn btn-sm btn-icon" title={`Scan ${c.name} now`} aria-label={`Scan ${c.name} now`} disabled={refresh.isPending}
              onClick={() => refresh.mutate({ roles: ["engineer", "developer", "software"], locations: loc.selected, companies: [c.name], include_internships: true, include_all_levels: false }, { onSuccess: () => toast(`Scanning ${c.name}. Results appear under Jobs.`, "info", { label: "Open Jobs", href: "/jobs" }), onError: (e) => toast(e.message, "error") })}
            ><Radar size={13} /></button>
          </motion.li>
        ))}
      </ul>

      {data && data.total > 0 && (
        <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.page_size} noun="companies"
          onPage={(p) => { set({ page: p === 1 ? null : p }, false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onPageSize={(n) => set({ size: n === 24 ? null : n })} />
      )}
    </div>
  );
}
