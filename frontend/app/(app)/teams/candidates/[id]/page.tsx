"use client";

import { ChevronLeft, Copy, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/providers";
import { Avatar } from "@/components/teams/parts";
import { Badge, ErrorNote, Skeleton } from "@/components/ui";
import { api, ApiError, json } from "@/lib/api";
import { copy, fullUrl, useCandidate } from "@/lib/teams";

const TABS = ["AI interview", "Assessment", "Activity"] as const;
const STAGE: Record<string, string> = { applied: "Applied", interview: "AI interview", assessment: "Assessment", panel: "Panel interview", offer: "Offer", rejected: "Rejected" };
const DIM: Record<string, string> = { communication: "Communication", structure: "Structure", depth: "Depth", evidence: "Evidence", role_fit: "Role fit" };
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const COUNT_LABEL: Record<string, string> = { tab_hidden: "Tab switches", window_blur: "Window left", paste: "Paste events", copy: "Copy events", fullscreen_exit: "Left full screen", multi_screen: "Extra screens", no_face: "Face not visible", multiple_faces: "More than one face", gaze_away: "Looked away", head_turned: "Head turned", camera_off: "Camera off", virtual_camera: "Virtual camera", devtools: "Developer tools", reload: "Reloads", shortcut: "Shortcuts", cursor_left: "Cursor left window", window_resized: "Window resized", focus_lost: "Focus lost", cut: "Cut events", context_menu: "Right-clicks" };

export default function CandidateReport() {
  const id = Number(useParams<{ id: string }>().id) || 0;
  const { data: c, error } = useCandidate(id);
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]>("AI interview");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(0);
  const act = async (fn: () => Promise<unknown>, fallback: string) => { try { await fn(); void qc.invalidateQueries({ queryKey: ["teams"] }); } catch (e) { toast(e instanceof ApiError ? e.message : fallback, "error"); } };
  if (error) return <ErrorNote>{error instanceof ApiError && error.status === 404 ? "That candidate does not exist." : "Could not load the candidate."}</ErrorNote>;
  if (!c) return <div className="space-y-4"><Skeleton className="h-12 w-72" /><Skeleton className="h-72" /></div>;
  const move = (stage: string) => act(() => api(`/teams/candidates/${c.id}/stage`, json({ stage })), "Could not move the candidate");
  const r = c.interview?.report ?? null;
  const ig = c.interview?.integrity;

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-muted"><Link href="/teams" className="inline-flex items-center gap-1 hover:text-fg"><ChevronLeft size={14} /> {c.job.title}</Link><span>›</span><span className="font-semibold text-fg">{c.name}</span></nav>
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4"><Avatar name={c.name} size={56} /><div><h1 className="text-[26px] font-bold tracking-tight">{c.name}</h1><p className="text-sm text-muted">{[c.school, c.email, c.job.title].filter(Boolean).join(" · ")}</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><Badge tone={c.stage === "rejected" ? "bad" : c.stage === "offer" ? "ok" : "brand"}>{STAGE[c.stage]}</Badge>
          <button className="btn" onClick={async () => toast((await copy(fullUrl(`/teams/candidates/${c.id}`))) ? "Link copied" : "Copy failed", "info")}><Copy size={14} /> Copy link</button>
          {c.stage !== "rejected" && <button className="btn" onClick={() => void move("rejected")}>Reject</button>}
          {c.stage !== "panel" && c.stage !== "offer" && c.stage !== "rejected" && <button className="btn btn-primary" onClick={() => void move("panel")}>Move to panel interview</button>}
          {c.stage === "panel" && <button className="btn btn-primary" onClick={() => void move("offer")}>Move to offer</button>}
          {c.stage === "rejected" && <button className="btn" onClick={() => void move("applied")}>Reopen</button>}</div>
      </section>
      <div role="tablist" aria-label="Candidate sections" className="flex gap-1 border-b border-line">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] ${tab === t ? "border-brand font-bold text-fg" : "border-transparent font-medium text-muted hover:text-fg"}`}>{t}</button>)}</div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {tab === "AI interview" && (!c.interview ? <section className="card p-6 text-sm"><p className="font-semibold">Has not started the interview</p><p className="mt-1 text-muted">{c.joined ? "They have opened the invite but not begun." : "They have not opened the invite yet."} Send them this link: <code className="break-all">{fullUrl(c.invite_path)}</code></p></section>
            : c.interview.status === "active" ? <section className="card p-6 text-sm"><p className="font-semibold">Interview in progress</p><p className="mt-1 text-muted">Started {when(c.interview.started_at)}. The report appears when they finish.</p></section>
            : !r ? <section className="card p-6 text-sm"><p className="font-semibold">Interview ended without a report</p><p className="mt-1 text-muted">The candidate left before the report was written. It is created when they finish.</p></section> : (<>
              <section className="card flex flex-wrap items-center gap-5 p-5"><div className="text-center"><p className="text-[44px] font-bold leading-none tracking-tight">{r.overall}</p><p className="eyebrow mt-1">AI score / 100</p></div>
                <div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-2">{c.recommendation && <Badge tone={c.recommendation === "advance" ? "ok" : c.recommendation === "hold" ? "warn" : "bad"}>SUGGESTION: {c.recommendation === "advance" ? "ADVANCE" : c.recommendation === "hold" ? "HOLD FOR REVIEW" : "REVIEW CLOSELY"}</Badge>}<span className="text-xs capitalize text-muted">{r.verdict.replace("_", " ")} · {c.interview.minutes}-minute interview</span></p><p className="mt-2 text-sm leading-relaxed">{r.summary}</p><p className="mt-2 text-xs text-subtle">The AI offers a suggestion and the evidence behind it. A person decides.</p></div></section>
              <section className="card p-5"><h2 className="text-base font-semibold">Scores with comments</h2><div className="mt-3 divide-y divide-line">{Object.entries(r.dimensions).map(([k, d], i) => (
                <div key={k}><button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)} className="flex w-full items-center gap-3 py-3 text-left"><span className="flex-1 text-sm font-semibold">{DIM[k] ?? k}</span><span className="flex gap-1" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <span key={n} className={`h-2 w-5 rounded-sm ${n <= d.score ? (d.score >= 4 ? "bg-ok" : "bg-warn") : "bg-surface2"}`} />)}</span><span className="w-9 text-right text-sm font-bold tabular-nums" aria-label={`${d.score} out of 5`}>{d.score}/5</span><span className="text-muted">{open === i ? "▴" : "▾"}</span></button>
                  {open === i && <p className="pb-4 text-[13px] text-muted">{d.comment || "No comment."}</p>}</div>))}</div></section>
              {!!r.evidence?.length && <section className="card p-5"><h2 className="text-base font-semibold">Evidence from the conversation</h2><div className="mt-3 space-y-3">{r.evidence.map((e, i) => <div key={i} className="rounded-lg border border-line p-3.5"><div className="mb-1.5 flex items-center gap-2"><Badge tone={e.category === "strength" ? "ok" : e.category === "development" ? "warn" : "neutral"} className="capitalize">{e.category}</Badge>{e.at && <span className="text-xs text-muted">{when(e.at)}</span>}</div><blockquote className="border-l-2 border-brand pl-3 text-[13px] italic">“{e.quote}”</blockquote><p className="mt-2 text-[13px]">{e.assessment}</p>{e.next_step && <p className="mt-1 text-xs text-muted">Next step: {e.next_step}</p>}</div>)}</div></section>}
              {!!r.questions.length && <section className="card p-5"><h2 className="text-base font-semibold">Question by question</h2><div className="mt-3 space-y-3">{r.questions.map((q, i) => <div key={i} className="rounded-lg border border-line p-3.5 text-[13px]"><div className="flex items-start justify-between gap-3"><p className="font-semibold">{q.question}</p><Badge tone={q.score >= 4 ? "ok" : q.score >= 3 ? "warn" : "bad"}>{q.score}/5</Badge></div><p className="mt-1.5 text-muted">{q.answer_summary}</p><p className="mt-1.5">{q.feedback}</p></div>)}</div></section>}
            </>))}
          {tab === "Assessment" && (!c.assessment ? <section className="card p-6 text-sm text-muted">No assessment has been started for this candidate.</section> : (
            <section className="card space-y-3 p-5 text-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{c.assessment.title}</p><p className="text-xs text-muted">{c.assessment.status === "done" ? `Finished ${when(c.assessment.finished_at)}` : `In progress since ${when(c.assessment.started_at)}`}</p></div>
              {c.assessment.status === "done" && <div className="text-right"><p className="text-[32px] font-bold leading-none">{c.assessment.score}%</p>{c.assessment.cutoff !== null && <p className={`mt-1 text-xs font-semibold ${(c.assessment.score ?? 0) >= c.assessment.cutoff ? "text-ok" : "text-bad"}`}>{(c.assessment.score ?? 0) >= c.assessment.cutoff ? "Above" : "Below"} the {c.assessment.cutoff}% cut-off</p>}</div>}</div>
              {c.assessment.per_question?.map((q) => <div key={q.index} className="flex items-center justify-between gap-3 border-t border-line pt-2.5"><span>Question {q.index + 1} <span className="text-muted">· {q.kind === "mc" ? "multiple choice" : "coding"}</span></span><span className="tabular-nums font-semibold">{q.earned} / {q.points}</span></div>)}</section>))}
          {tab === "Activity" && (
            <ol className="card space-y-3 p-5 text-sm">{[[c.created_at, "Invited"], c.joined && [c.created_at, "Opened the invite and signed in"], c.interview && [c.interview.started_at, "Started the AI interview"], c.interview?.finished_at && [c.interview.finished_at, "Finished the AI interview"], c.assessment && [c.assessment.started_at, "Started the assessment"], c.assessment?.finished_at && [c.assessment.finished_at, "Finished the assessment"]].filter(Boolean).map((e, i) => <li key={i} className="flex justify-between gap-3"><span>{(e as string[])[1]}</span><span className="text-muted">{when((e as string[])[0])}</span></li>)}</ol>)}
        </div>
        <aside className="space-y-4">
          <section className="card p-5"><h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} className={ig?.monitored && ig.status === "clean" ? "text-ok" : "text-muted"} /> Integrity signals</h2>
            {!ig ? <p className="mt-2 text-[13px] text-muted">Appear after the interview starts.</p> : !ig.monitored ? <p className="mt-2 text-[13px] text-muted">This interview was not monitored. Monitoring runs only when the role has it switched on and the candidate agrees.</p> : (<>
              <p className={`mt-1 text-xs font-semibold ${ig.status === "clean" ? "text-ok" : "text-warn"}`}>{ig.status === "clean" ? "No concerns detected" : ig.status === "review" ? "A few signals to look at" : "Several signals to look at"} (score {ig.score})</p>
              <dl className="mt-3 space-y-2 text-[13px]">{Object.entries(ig.counts ?? {}).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{COUNT_LABEL[k] ?? k.replaceAll("_", " ")}</dt><dd className="font-medium">{v}</dd></div>)}{!Object.keys(ig.counts ?? {}).length && <p className="text-muted">Nothing was recorded.</p>}<div className="flex justify-between gap-3 border-t border-line pt-2"><dt className="text-muted">Time away</dt><dd className="font-medium">{ig.away_seconds ?? 0}s</dd></div></dl>
              <p className="mt-3 text-xs leading-relaxed text-subtle">Automated signals only. A notification, glasses or a bad webcam angle can trigger them. They are a prompt to look, never proof.</p></>)}</section>
          <section className="card p-5"><h2 className="text-sm font-semibold">Team notes</h2><ul className="mt-3 space-y-3">{c.notes.map((n, i) => <li key={i} className="text-[13px]"><p><b>{n.by}</b> <span className="text-xs text-muted">{when(n.at)}</span></p><p className="mt-0.5 whitespace-pre-wrap">{n.text}</p></li>)}{!c.notes.length && <li className="text-[13px] text-muted">No notes yet.</li>}</ul>
            <label className="mt-3 block"><span className="sr-only">Add a note</span><textarea className="input" rows={3} placeholder="Add a note for the hiring team…" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
            <button className="btn btn-sm mt-2" disabled={!note.trim()} onClick={() => void act(async () => { await api(`/teams/candidates/${c.id}/notes`, json({ text: note })); setNote(""); }, "Could not save the note")}>Add note</button></section>
        </aside>
      </div>
    </div>
  );
}
