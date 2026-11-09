"use client";

import { Brain, ChevronDown, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/app/providers";
import { useDialog } from "@/components/Dialog";
import { ErrorNote, Skeleton } from "@/components/ui";
import { useClearInterviewMemory, useInterviewMemory, useSaveInterviewMemory } from "@/lib/hooks";

export default function MemoryPanel() {
  const memory = useInterviewMemory(), save = useSaveInterviewMemory(), clear = useClearInterviewMemory();
  const toast = useToast(), dialog = useDialog();
  const [draft, setDraft] = useState<string | null>(null);
  const notes = draft ?? memory.data?.notes ?? "";
  const busy = save.isPending || clear.isPending;
  const persist = (enabled: boolean) => save.mutate({ enabled, notes }, { onSuccess: () => { setDraft(null); toast(enabled ? "Practice memory saved" : "Memory paused. Saved context will no longer be added."); }, onError: (e) => toast(e.message, "error") });
  return <section className="card p-5 sm:p-6" aria-labelledby="memory-title">
    <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Brain size={20} /></span><div className="min-w-0 flex-1"><h2 id="memory-title" className="text-lg font-semibold">Practice that remembers you</h2><p className="mt-1 text-sm leading-relaxed text-muted">Save your goals and background. Let future conversations build on recent feedback.</p></div><span className="chip bg-surface2 text-muted">{memory.data?.enabled ? "Active" : "Paused"}</span></div>
    {memory.isPending ? <Skeleton className="mt-5 h-20" /> : memory.isError ? <div className="mt-4"><ErrorNote>{memory.error.message} <button className="underline" onClick={() => void memory.refetch()}>Retry</button></ErrorNote></div> : <>
      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-line p-4"><input type="checkbox" checked={memory.data.enabled} disabled={busy} onChange={(e) => persist(e.target.checked)} className="mt-1" /><span><span className="block text-sm font-medium">Use my personal practice memory</span><span className="mt-1 block text-xs leading-relaxed text-muted">Uses your saved notes, up to three completed reports, and a recent resume from those sessions. Relevant context is sent to the AI provider during interviews. This personalizes prompts; it does not retrain the model.</span></span></label>
      <label htmlFor="practice-notes" className="label mt-5">What should your interviewer know?</label><textarea id="practice-notes" className="input min-h-28" maxLength={4000} disabled={busy} value={notes} onChange={(e) => setDraft(e.target.value)} placeholder="Your target role, projects, skills to work on, or how you prefer to practice…" /><p className="mt-2 text-xs text-subtle">Use professional context you want to reuse. You can correct or remove it any time.</p>
      <div className="mt-4 flex flex-wrap gap-2"><button className="btn" disabled={busy || notes === memory.data.notes} onClick={() => persist(memory.data.enabled)}><Save size={14} />{save.isPending ? "Saving…" : "Save context"}</button><button className="btn btn-ghost text-bad!" disabled={busy} onClick={async () => { if (await dialog.confirm({ title: "Clear practice memory?", body: "Saved notes will be removed and memory paused. Previous sessions will stop being reused, even if you enable memory later. Your interview history remains available.", confirmLabel: "Clear memory", danger: true })) clear.mutate(undefined, { onSuccess: () => { setDraft(null); toast("Practice memory cleared and paused"); }, onError: (e) => toast(e.message, "error") }); }}><Trash2 size={14} />{clear.isPending ? "Clearing…" : "Clear memory"}</button></div>
      <details className="group mt-5 border-t border-line pt-4"><summary className="flex list-none items-center justify-between text-sm font-medium">Review available context <ChevronDown size={15} className="transition group-open:rotate-180" /></summary><div className="mt-4 space-y-4 text-xs text-muted">{memory.data.resume && <p>Resume: <Link className="font-medium text-brand underline" href={`/resumes/${memory.data.resume.id}`}>{memory.data.resume.name}</Link></p>}{memory.data.sources.length ? memory.data.sources.map((s) => <article key={s.id} className="border-l-2 border-line pl-3"><Link href={`/interviews/${s.id}`} className="font-semibold text-brand">{s.role} · View report</Link><p className="mt-1 leading-relaxed">{s.summary}</p><ul className="mt-2 list-disc space-y-1 pl-4">{s.practice_plan.map((p, i) => <li key={i}>{p}</li>)}</ul></article>) : <p>No completed reports available for memory. Your next completed session can provide practice context.</p>}<p className="text-subtle">{memory.data.enabled ? "These sources may inform future questions. Scores are based only on the current interview." : "Memory is paused. These sources are not sent as practice memory."}</p></div></details>
    </>}
  </section>;
}
