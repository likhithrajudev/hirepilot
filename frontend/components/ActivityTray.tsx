"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, Loader2, ScanSearch, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePopover } from "@/components/popover";
import { timeAgo } from "@/components/ui";
import { useDeleteTask, useTasks } from "@/lib/hooks";

/** Nav button + popover showing background AI work. Works from any page; the server owns the state. */
export default function ActivityTray() {
  const { data } = useTasks({ limit: 12 });
  const del = useDeleteTask();
  const { open, setOpen, root } = usePopover();
  const running = (data ?? []).filter((t) => t.status === "queued" || t.status === "running");
  if (!data?.length) return null;

  const icon = (s: string) => s === "done" ? <CheckCircle2 size={15} className="text-ok" /> : s === "error" ? <AlertCircle size={15} className="text-bad" /> : s === "cancelled" ? <X size={15} className="text-subtle" /> : <Loader2 size={15} className="animate-spin text-brand" />;
  return (
    <div className="relative" ref={root}>
      <button data-popover-trigger className={`btn btn-ghost !gap-2 ${running.length ? "!text-brand" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`AI activity, ${running.length} running`}>
        {running.length ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        <span className="hidden text-xs font-medium sm:inline">{running.length ? `${running.length} running` : "Activity"}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.14 }}
            className="absolute right-0 z-50 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-lg border border-line2 bg-surface shadow-pop"
          >
            <div className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-subtle">AI activity</div>
            <ul data-lenis-prevent className="max-h-[360px] overflow-auto p-1.5">
              {data.map((t) => (
                <li key={t.id} className="group flex items-start gap-3 rounded-lg px-2.5 py-2.5 hover:bg-surface2">
                  <span className="mt-0.5">{icon(t.status)}</span>
                  <Link href={t.status === "done" && t.kind === "tailor" ? `/resumes/${t.resume_id}?review=${t.id}` : `/resumes/${t.resume_id}${t.kind === "ats" ? "?tab=ats" : ""}`} onClick={() => setOpen(false)} className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">{t.kind === "tailor" ? <Sparkles size={12} className="text-subtle" /> : <ScanSearch size={12} className="text-subtle" />}{t.kind === "tailor" ? "Tailor" : "ATS check"}<span className="truncate font-normal text-muted">{t.label}</span></div>
                    <div className="mt-0.5 truncate text-xs text-subtle">{t.status === "error" ? t.error : t.status === "done" ? `Finished ${timeAgo(t.finished_at ?? t.created_at)}` : t.progress || "Queued"}</div>
                  </Link>
                  <button aria-label={t.status === "running" || t.status === "queued" ? "Cancel" : "Dismiss"} className="btn btn-ghost btn-icon !h-6 !w-6 opacity-0 transition group-hover:opacity-100 focus:opacity-100" onClick={() => del.mutate(t.id)}><X size={12} /></button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
