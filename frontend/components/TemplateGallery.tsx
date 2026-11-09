"use client";

import { motion } from "motion/react";
import { Check, FilePlus2, FileText, Loader2, Lock, ScanSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/providers";
import { useCreateFromTemplate, useSubscription, useTemplates } from "@/lib/hooks";
import { planById } from "@/lib/plans";
import { Modal } from "./Dialog";
import { Skeleton } from "./ui";

function Thumb({ id, paper }: { id: string; paper: string }) {
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  return (
    <div className="relative aspect-[1/1.2] overflow-hidden rounded-lg border border-line bg-white">
      {state === "loading" && <Skeleton className="absolute inset-0 !rounded-none" />}
      {state === "fail" ? (
        <div className="grid h-full place-items-center p-3 text-center text-[11px] text-subtle"><FileText className="mb-1" />Preview unavailable</div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/templates/${id}/preview.png?paper=${paper}`} alt={`${id} template preview`} loading="lazy" onLoad={() => setState("ok")} onError={() => setState("fail")}
          className={`h-full w-full object-cover object-top transition-opacity duration-300 ${state === "ok" ? "opacity-100" : "opacity-0"}`} />
      )}
    </div>
  );
}

export default function TemplateGallery({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { data, isLoading } = useTemplates();
  const create = useCreateFromTemplate();
  const [sel, setSel] = useState("classic");
  const [paper, setPaper] = useState("a4paper");
  const [name, setName] = useState("");
  const sub = useSubscription();
  const included = planById(sub.data?.plan.id ?? "cadet").templates;
  const locked = (id: string) => !!sub.data && !included.includes(id);
  const chosen = data?.find((t) => t.id === sel);

  return (
    <Modal
      open={open} onClose={onClose} size="xl" icon={<FilePlus2 size={18} />}
      title="Start from a template"
      description="Every template is single-column with real text and standard headings, so applicant tracking systems read it cleanly. Your profile details fill the header."
      footer={
        <>
          <div className="mr-auto flex items-center gap-3">
            <div className="seg" role="group" aria-label="Paper size">
              <button aria-pressed={paper === "a4paper"} onClick={() => setPaper("a4paper")}>A4</button>
              <button aria-pressed={paper === "letterpaper"} onClick={() => setPaper("letterpaper")}>Letter</button>
            </div>
            <input className="input !w-56" aria-label="Resume name" placeholder={`${chosen?.name ?? "Classic"} resume`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary" disabled={create.isPending}
            onClick={() => create.mutate({ template_id: sel, paper, name: name.trim() || undefined }, {
              onSuccess: (r) => { onClose(); router.push(`/resumes/${r.id}`); },
              onError: (e) => toast(e.message, "error"),
            })}
          >
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : locked(sel) ? <Lock size={14} /> : <Check size={14} />} {locked(sel) ? `Unlock ${chosen?.name ?? "template"}` : `Use ${chosen?.name ?? "template"}`}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4 pb-4 pt-1 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label="Templates">
        {isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72" />)}
        {data?.map((t, i) => (
          <motion.button
            key={t.id} role="radio" aria-checked={sel === t.id} onClick={() => setSel(t.id)}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.3 }}
            whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}
            className={`group relative flex flex-col gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${sel === t.id ? "border-brand bg-brand-soft/60 ring-2 ring-[var(--ring)]" : "border-line bg-surface hover:border-line2"}`}
          >
            <Thumb id={t.id} paper={paper} />
            {sel === t.id && <span className="absolute right-4 top-4 grid h-6 w-6 place-items-center rounded-full bg-brand text-brand-fg shadow"><Check size={13} /></span>}
            <div className="px-0.5">
              <div className="text-[13.5px] font-semibold">{t.name}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{t.tagline}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {t.ats_parse !== null && <span className="chip bg-ok-soft text-ok"><ScanSearch size={10} /> ATS {t.ats_parse}</span>}
                <span className="chip bg-surface2 text-muted">{t.font}</span>
                {locked(t.id) && <span className="chip bg-surface2 text-muted"><Lock size={10} /> Pilot</span>}
              </div>
              <div className="mt-1.5 text-[11px] text-subtle">Best for: {t.best_for}</div>
            </div>
          </motion.button>
        ))}
      </div>
    </Modal>
  );
}
