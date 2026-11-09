"use client";

import { ArrowUpRight, FilePlus2, FileText, History, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import TemplateGallery from "@/components/TemplateGallery";
import { useToast } from "@/app/providers";
import { useDialog } from "@/components/Dialog";
import { EmptyState, ErrorNote, PageHeader, Skeleton, timeAgo } from "@/components/ui";
import { useCreateResume, useDeleteResume, useResumes } from "@/lib/hooks";

export default function Page() {
  return <Suspense fallback={null}><ResumesPage /></Suspense>;
}

function ResumesPage() {
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useDialog();
  const { data, isLoading, error } = useResumes();
  const create = useCreateResume();
  const del = useDeleteResume();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const sp = useSearchParams();
  const [gallery, setGallery] = useState(false);
  useEffect(() => { if (sp.get("new")) { setGallery(true); router.replace("/resumes"); } }, [sp, router]);

  const createAndOpen = (name: string, latex: string) =>
    create.mutate({ name, latex }, { onSuccess: (r) => router.push(`/resumes/${r.id}`) });

  const onFile = async (f?: File) => {
    if (!f) return;
    if (!/\.(tex|txt)$/i.test(f.name)) return toast("Please choose a .tex file", "error");
    createAndOpen(f.name.replace(/\.tex$/i, ""), await f.text());
  };

  return (
    <div
      className="workspace-page relative space-y-6"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
    >
      <PageHeader
        eyebrow="Prepare / Resume studio"
        title="Your experience. Well told."
        subtitle="One strong foundation. A tailored story for every opportunity. Build, refine, and export your LaTeX resumes here."
        actions={
          <>
            <input ref={fileRef} type="file" accept=".tex,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button disabled={create.isPending} className="btn" onClick={() => fileRef.current?.click()}><Upload size={15} /> Upload .tex</button>
            <button className="btn btn-primary" onClick={() => setGallery(true)}>
              <FilePlus2 size={15} /> New from template
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-4"><div className="flex items-center gap-3"><FileText size={18} className="text-brand" /><div><p className="text-sm font-semibold">Your resume library</p><p className="mt-0.5 text-xs text-muted">Master files and their tailored versions, together.</p></div></div><span className="font-mono text-xs text-muted">{data ? `${data.length} document${data.length === 1 ? "" : "s"}` : "—"}</span></div>
      {create.isError && <ErrorNote>{create.error.message}</ErrorNote>}
      {error && <ErrorNote>{error.message}</ErrorNote>}

      {isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>}

      {data?.length === 0 && (
        <EmptyState
          icon={<FileText size={22} />}
          title="No resumes yet"
          body={<>Drag a <code className="font-mono text-xs">.tex</code> file anywhere on this page, or start from a clean template.</>}
          action={<button className="btn btn-primary" onClick={() => setGallery(true)}><FilePlus2 size={15} /> Choose a template</button>}
        />
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((r, i) => (
          <li key={r.id} className="rise group relative" style={{ animationDelay: `${i * 40}ms` }}>
            <Link href={`/resumes/${r.id}`} className="card card-hover flex h-full flex-col gap-5 overflow-hidden">
              <div className="resume-preview" aria-hidden="true"><div className="resume-preview-paper"><div className="mb-2 h-2 w-20 rounded-sm bg-brand/70" /><div className="mb-5 h-1 w-24 bg-line2" />{[0, 1, 2].map((n) => <div key={n} className="mb-4"><div className="mb-2 h-1 w-12 bg-brand/40" /><div className="space-y-1.5">{[100, 85, 95].map((w) => <div key={w} className="h-[2px] bg-line2" style={{ width: `${w}%` }} />)}</div></div>)}</div><span className="absolute bottom-3 right-3 rounded border border-line bg-surface px-2 py-1 font-mono text-[10px] text-muted">.tex</span></div>
              <div className="min-w-0 px-5"><h2 className="truncate pr-6 text-[15px] font-semibold">{r.name}</h2><p className="mt-1.5 text-xs text-subtle">Edited {timeAgo(r.updated_at)}</p></div>
              <div className="mx-5 mb-4 mt-auto flex items-center justify-between border-t border-line pt-4 text-xs text-muted">
                <span className="chip bg-surface2"><History size={11} /> {r.version_count} version{r.version_count === 1 ? "" : "s"}</span>
                <span className="inline-flex items-center gap-1 font-medium text-brand">Open editor <ArrowUpRight size={13} /></span>
              </div>
            </Link>
            <button
              title="Delete resume"
              aria-label={`Delete ${r.name}`}
              disabled={del.isPending} className="btn btn-danger btn-icon absolute right-3 top-[183px] bg-surface! transition"
              onClick={async () => (await confirm({ title: "Delete this resume?", body: `"${r.name}" and all of its tailored versions will be removed permanently.`, confirmLabel: "Delete resume", danger: true })) && del.mutate(r.id, { onSuccess: () => toast("Resume deleted"), onError: (e) => toast(e.message, "error") })}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>

      <TemplateGallery open={gallery} onClose={() => setGallery(false)} />

      {drag && (
        <div className="pop pointer-events-none fixed inset-4 z-50 grid place-items-center rounded-3xl border-2 border-dashed border-brand bg-brand-soft/80 backdrop-blur-sm">
          <div className="text-center text-brand"><Upload className="mx-auto mb-2" /><p className="font-medium">Drop your .tex file to import</p></div>
        </div>
      )}
    </div>
  );
}
