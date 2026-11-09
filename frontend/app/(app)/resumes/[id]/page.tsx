"use client";

import { AlertCircle, Check, CheckCircle2, ChevronLeft, ChevronDown, Download, FileCode2, FileText, History, Loader2, PanelRightClose, Play, ScanSearch, RotateCcw, Save, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/app/providers";
import { LatexDiff, LatexEditor } from "@/components/LatexEditor";
import AtsPanel from "@/components/AtsPanel";
import { useDialog } from "@/components/Dialog";
import { useCollapseSidebar } from "@/components/Sidebar";
import TailorPanel, { type JobForm, type TailorMeta } from "@/components/TailorPanel";
import VersionsPanel from "@/components/VersionsPanel";
import { Skeleton, Tabs } from "@/components/ui";
import { ApiError, compilePdf, download } from "@/lib/api";
import { useCreateVersion, useDeleteTask, useResume, useTask, useUpdateResume } from "@/lib/hooks";
import { usePrefs } from "@/lib/prefs";
import type { TailorResult } from "@/lib/types";

type Compile =
  | { state: "idle" }
  | { state: "busy"; url?: string }
  | { state: "ok"; url: string }
  | { state: "error"; errors: string[]; log: string; url?: string };

export default function Page() {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <Workspace />
    </Suspense>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 gap-px bg-line xl:grid-cols-[1fr_1fr_380px]">
      {[0, 1, 2].map((i) => <div key={i} className="bg-surface p-5"><Skeleton className="mb-3 h-5 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="mt-2 h-4 w-5/6" /><Skeleton className="mt-2 h-4 w-2/3" /></div>)}
    </div>
  );
}

function Workspace() {
  useCollapseSidebar(); // the editor needs the width: tuck the app sidebar away while it is open
  const toast = useToast();
  const { confirm } = useDialog();
  const [jobForm, setJobForm] = useState<JobForm>({ company: "", title: "", jd: "" });
  const id = Number(useParams<{ id: string }>().id);
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { prefs } = usePrefs();
  const delTask = useDeleteTask();
  const jobParam = sp.get("job");
  const jobId = jobParam ? Number(jobParam) : null;
  const reviewParam = sp.get("review");
  const tabParam = sp.get("tab");

  const { data: resume, isLoading, error } = useResume(id);
  const save = useUpdateResume(id);
  const addVersion = useCreateVersion(id);

  const [latex, setLatex] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tab, setTab] = useState<"tailor" | "ats" | "versions">(tabParam === "ats" ? "ats" : tabParam === "versions" ? "versions" : "tailor");
  const [proposal, setProposal] = useState<{ result: TailorResult; meta: TailorMeta; taskId: string } | null>(null);
  const [compile, setCompile] = useState<Compile>({ state: "idle" });
  const [auto, setAuto] = useState(prefs.auto_compile);
  useEffect(() => setAuto(prefs.auto_compile), [prefs.auto_compile]);
  const [showLog, setShowLog] = useState(false);
  const [asideOpen, setAsideOpen] = useState(true);
  useEffect(() => { try { setAsideOpen(localStorage.getItem("hp_aside") !== "closed"); } catch {} }, []);
  const setAside = (v: boolean) => { setAsideOpen(v); try { localStorage.setItem("hp_aside", v ? "open" : "closed"); } catch {} };
  const [pane, setPane] = useState<"edit" | "preview">("edit"); // only used below the xl breakpoint
  const seq = useRef(0);

  useEffect(() => {
    if (resume && latex === null) {
      setLatex(resume.latex);
      setName(resume.name);
    }
  }, [resume, latex]);

  // The job description form survives navigation and reloads.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`hp_jobform_${id}`);
      if (saved) setJobForm((cur) => (cur.jd || cur.company || cur.title ? cur : JSON.parse(saved)));
    } catch {}
  }, [id]);
  useEffect(() => {
    try { localStorage.setItem(`hp_jobform_${id}`, JSON.stringify(jobForm)); } catch {}
  }, [id, jobForm]);

  // Opened from a "your tailoring is ready" notification: load that result straight into the review diff.
  const reviewTask = useTask<TailorResult>(reviewParam);
  useEffect(() => {
    const t = reviewTask.data;
    if (!t?.result || proposal) return;
    const pl = ((t as unknown) as { payload?: Record<string, string | number> }).payload ?? {};
    setProposal({ result: t.result, taskId: t.id, meta: { company: String(pl.company ?? ""), job_title: String(pl.job_title ?? ""), job_description: String(pl.job_description ?? ""), job_id: pl.job_id ? Number(pl.job_id) : undefined } });
    setTab("tailor");
    router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewTask.data]);

  const dirty = resume !== undefined && latex !== null && (latex !== resume.latex || name !== resume.name);

  const runCompile = useCallback(async (src: string) => {
    const mine = ++seq.current;
    setCompile((c) => ({ state: "busy", url: "url" in c ? c.url : undefined }));
    try {
      const url = await compilePdf(src);
      if (mine !== seq.current) return URL.revokeObjectURL(url);
      setCompile((c) => {
        if ("url" in c && c.url) URL.revokeObjectURL(c.url);
        return { state: "ok", url };
      });
    } catch (e) {
      if (mine !== seq.current) return;
      const err = e as ApiError;
      setCompile((c) => ({
        state: "error",
        errors: err.errors?.length ? err.errors : [err.message],
        log: err.log ?? "",
        url: "url" in c ? c.url : undefined, // keep showing the last good PDF
      }));
    }
  }, []);

  // Compile once on load, then debounce while typing if auto-compile is on.
  const first = useRef(true);
  useEffect(() => {
    if (latex === null || proposal) return;
    const delay = first.current ? 0 : prefs.auto_compile_delay_ms;
    if (!first.current && !auto) return;
    first.current = false;
    const t = setTimeout(() => runCompile(latex), delay);
    return () => clearTimeout(t);
  }, [latex, auto, proposal, runCompile, prefs.auto_compile_delay_ms]);

  const doSave = useCallback(() => {
    if (latex === null) return;
    save.mutate({ name, latex }, { onSuccess: () => toast("Saved"), onError: (e) => toast(e.message, "error") });
    runCompile(latex);
  }, [latex, name, save, runCompile, toast]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => dirty && e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const accept = () => {
    if (!proposal) return;
    const { result, meta } = proposal;
    addVersion.mutate(
      {
        latex: result.latex,
        company: meta.company || null,
        job_title: meta.job_title || null,
        job_description: meta.job_description,
        job_id: meta.job_id ?? null,
        meta: { changes: result.changes, matched: result.matched_keywords, missing: result.missing_keywords, fit: result.estimated_fit },
      },
      { onSuccess: () => toast("Tailored version saved") },
    );
    setLatex(result.latex);
    delTask.mutate(proposal.taskId);
    setProposal(null);
    setTab("versions");
  };

  if (error) return <p className="p-6 text-bad">{(error as Error).message}</p>;
  if (isLoading || latex === null) return <WorkspaceSkeleton />;

  const pdfUrl = "url" in compile ? compile.url : undefined;
  const busy = compile.state === "busy";

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* ───── toolbar ───── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Link href="/resumes" className="btn btn-ghost btn-icon" aria-label="Back to resumes"><ChevronLeft size={18} /></Link>
        <input
          aria-label="Resume name"
          className="h-8 w-52 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold outline-none transition hover:border-line2 focus:border-brand focus:bg-surface2"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {dirty ? (
          <span className="chip bg-warn-soft text-warn"><span className="h-1.5 w-1.5 rounded-full bg-warn" /> Unsaved</span>
        ) : save.isPending ? (
          <span className="chip bg-surface2 text-muted"><Loader2 size={11} className="animate-spin" /> Saving</span>
        ) : (
          <span className="chip bg-surface2 text-subtle"><Check size={11} /> Saved</span>
        )}

        <CompilePill compile={compile} />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!proposal && (
            <div className="seg xl:hidden!" role="group" aria-label="Pane">
              {(["edit", "preview"] as const).map((p) => (
                <button key={p} aria-pressed={pane === p} onClick={() => setPane(p)} className="capitalize">{p}</button>
              ))}
            </div>
          )}
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--brand)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-compile
          </label>
          {resume && latex !== resume.latex && (
            <button className="btn btn-ghost" title="Discard edits and reload the saved master" onClick={() => setLatex(resume.latex)}>
              <RotateCcw size={14} /> Revert
            </button>
          )}
          <button className="btn" disabled={busy || !!proposal} onClick={() => runCompile(latex)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Compile
          </button>
          <ExportMenu
            resumeId={id}
            dirty={dirty}
            hasPdf={!!pdfUrl}
            onExportCurrent={(fmt) => {
              if (fmt === "tex") {
                const blob = new Blob([latex], { type: "application/x-tex" });
                const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${name}.tex` });
                a.click();
                URL.revokeObjectURL(a.href);
              } else if (pdfUrl) {
                Object.assign(document.createElement("a"), { href: pdfUrl, download: `${name}.pdf` }).click();
              }
            }}
          />
          <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={doSave}>
            <Save size={14} /> Save <span className="kbd !border-white/30 !bg-white/15 !text-inherit">⌘S</span>
          </button>
        </div>
      </div>

      {proposal && (
        <div className="pop flex shrink-0 flex-wrap items-center gap-3 border-b border-brand/25 bg-brand-soft px-4 py-2.5 text-sm">
          <Sparkles size={15} className="text-brand" />
          <span className="font-semibold text-brand">Reviewing AI changes{proposal.meta.company ? ` for ${proposal.meta.company}` : ""}</span>
          <span className="hidden text-muted sm:inline">Left: your current text · Right: proposed</span>
          <div className="ml-auto flex gap-2">
            <button className="btn" onClick={() => { if (proposal) delTask.mutate(proposal.taskId); setProposal(null); }}><X size={14} /> Discard</button>
            <button className="btn btn-primary" onClick={accept}><Check size={14} /> Accept &amp; save version</button>
          </div>
        </div>
      )}

      {/* ───── workspace ───── */}
      <div className={`grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ${asideOpen ? "grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_380px]" : "grid-cols-[minmax(0,1fr)_48px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_48px]"}`}>
        <div className={`min-h-0 border-r border-line bg-surface ${proposal ? "xl:col-span-2" : ""} ${!proposal && pane === "preview" ? "hidden xl:block" : ""}`}>
          {proposal ? <LatexDiff original={latex} modified={proposal.result.latex} /> : <LatexEditor value={latex} onChange={setLatex} onSave={doSave} />}
        </div>

        {!proposal && (
          <div className={`relative min-h-0 flex-col border-r border-line bg-surface2 ${pane === "edit" ? "hidden xl:flex" : "flex"}`}>
            <div className="relative min-h-0 flex-1">
              {pdfUrl ? (
                <iframe title="PDF preview" src={`${pdfUrl}#toolbar=0&navpanes=0`} className="h-full w-full bg-white" />
              ) : (
                <div className="grid h-full place-items-center p-6 text-center">
                  {busy ? (
                    <div className="flex flex-col items-center gap-3 text-sm text-muted"><Loader2 className="animate-spin text-brand" /> Compiling your resume…</div>
                  ) : compile.state === "error" ? (
                    <div className="flex flex-col items-center gap-2 text-sm text-muted"><AlertCircle className="text-bad" /> No PDF yet. See the errors below.</div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-sm text-subtle"><FileText /> Preview appears here</div>
                  )}
                </div>
              )}
              {busy && pdfUrl && (
                <div className="pop absolute right-4 top-3 flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs shadow-pop ring-1 ring-line">
                  <Loader2 size={12} className="animate-spin text-brand" /> Compiling
                </div>
              )}
            </div>
            {compile.state === "error" && (
              <div className="pop max-h-56 shrink-0 overflow-auto border-t border-bad/25 bg-bad-soft p-4 text-xs text-bad">
                <div className="mb-2 flex items-center gap-1.5 font-semibold"><AlertCircle size={14} /> Compile failed</div>
                <ul className="space-y-1.5">
                  {compile.errors.map((e, i) => (
                    <li key={i} className={`rounded-md px-2 py-1 leading-relaxed ${e.startsWith("Likely cause") ? "bg-surface font-medium ring-1 ring-bad/30" : ""}`}>{e}</li>
                  ))}
                </ul>
                {compile.log && (
                  <>
                    <button className="mt-2 font-medium underline underline-offset-2" onClick={() => setShowLog((s) => !s)}>{showLog ? "Hide" : "Show"} full log</button>
                    {showLog && <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface p-2 font-mono text-[11px] text-muted">{compile.log}</pre>}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <aside className="flex min-h-0 flex-col overflow-hidden bg-surface" data-lenis-prevent>
          {!asideOpen ? (
            <div className="flex flex-col items-center gap-1 py-2" role="toolbar" aria-label="Side panel tabs">
              {([["tailor", "AI Tailor", Sparkles], ["ats", "ATS Check", ScanSearch], ["versions", "Versions", History]] as const).map(([k, label, Icon]) => (
                <button key={k} title={label} aria-label={`Open ${label}`} className={`btn btn-icon btn-ghost ${tab === k ? "!bg-brand-soft !text-brand" : ""}`} onClick={() => { setTab(k); setAside(true); }}><Icon size={16} /></button>
              ))}
              <button title="Expand panel" aria-label="Expand side panel" className="btn btn-icon btn-ghost mt-1 text-subtle" onClick={() => setAside(true)}><PanelRightClose size={16} className="rotate-180" /></button>
            </div>
          ) : (<>
          <div className="flex shrink-0 gap-1 border-b border-line p-2">
            <Tabs idPrefix="side" label="Side panel" value={tab} onChange={setTab} className="min-w-0 flex-1"
              items={[{ id: "tailor", label: "AI Tailor", icon: <Sparkles size={14} /> }, { id: "ats", label: "ATS Check", icon: <ScanSearch size={14} /> }, { id: "versions", label: "Versions", icon: <History size={14} /> }]} />
            <button title="Collapse panel" aria-label="Collapse side panel" className="btn btn-icon btn-ghost shrink-0 text-subtle" onClick={() => setAside(false)}><PanelRightClose size={16} /></button>
          </div>
          <div data-lenis-prevent role="tabpanel" id="side-panel" aria-labelledby={`side-tab-${tab}`} className="min-h-0 flex-1 overflow-auto">
            {tab === "tailor" ? (
              <TailorPanel resumeId={id} latex={latex} jobId={jobId} onReview={(result, meta, taskId) => setProposal({ result, meta, taskId })} reviewingTaskId={proposal?.taskId ?? null} form={jobForm} setForm={setJobForm} />
            ) : tab === "ats" ? (
              <AtsPanel resumeId={id} latex={latex} form={jobForm} setForm={setJobForm} />
            ) : (
              <VersionsPanel
                resumeId={id}
                latex={latex}
                onOpen={async (v) => {
                  if (!dirty || (await confirm({ title: "Replace editor contents?", body: "Your unsaved edits will be lost.", confirmLabel: "Replace", danger: true }))) {
                    setLatex(v.latex);
                    setProposal(null);
                  }
                }}
              />
            )}
          </div>
          </>)}
        </aside>
      </div>
    </div>
  );
}

function CompilePill({ compile }: { compile: Compile }) {
  if (compile.state === "busy") return <span className="chip bg-brand-soft text-brand"><Loader2 size={11} className="animate-spin" /> Compiling</span>;
  if (compile.state === "ok") return <span className="chip bg-ok-soft text-ok"><CheckCircle2 size={11} /> PDF ready</span>;
  if (compile.state === "error") return <span className="chip bg-bad-soft text-bad"><AlertCircle size={11} /> Compile error</span>;
  return null;
}

function ExportMenu({ resumeId, dirty, hasPdf, onExportCurrent }: { resumeId: number; dirty: boolean; hasPdf: boolean; onExportCurrent: (fmt: "pdf" | "tex") => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const serverExport = async (fmt: "zip") => {
    setBusy(true);
    try {
      await download(`/resumes/${resumeId}/export?format=${fmt}`, `resume.${fmt}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const Item = ({ icon, title, hint, disabled, onClick }: { icon: React.ReactNode; title: string; hint: string; disabled?: boolean; onClick: () => void }) => (
    <button disabled={disabled} onClick={onClick} className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-surface2 disabled:pointer-events-none disabled:opacity-40">
      <span className="mt-0.5 text-muted">{icon}</span>
      <span><span className="block text-[13px] font-medium">{title}</span><span className="block text-xs text-subtle">{hint}</span></span>
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export <ChevronDown size={12} className="text-subtle" />
      </button>
      {open && (
        <div role="menu" className="pop absolute right-0 z-30 mt-2 w-72 rounded-xl border border-line2 bg-surface p-1.5 shadow-pop">
          <Item icon={<FileText size={15} />} title="PDF" hint={hasPdf ? "Current preview" : "Compile first"} disabled={!hasPdf} onClick={() => (onExportCurrent("pdf"), setOpen(false))} />
          <Item icon={<FileCode2 size={15} />} title=".tex source" hint="Current editor contents" onClick={() => (onExportCurrent("tex"), setOpen(false))} />
          <div className="my-1 border-t border-line" />
          <Item icon={<Download size={15} />} title="Saved master (.zip)" hint={dirty ? "Save your changes first" : "tex + pdf bundle"} disabled={dirty} onClick={() => serverExport("zip")} />
        </div>
      )}
    </div>
  );
}
