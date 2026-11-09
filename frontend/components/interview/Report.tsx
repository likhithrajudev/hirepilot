"use client";

import { Check, Clock, FileDown, Lightbulb, ShieldCheck, Target, TrendingUp } from "lucide-react";
import Recordings from "./Recordings";
import CodingReview from "./CodingReview";
import { dateTime } from "@/lib/portal";
import { Badge, ScoreRing, type Tone } from "@/components/ui";
import type { Integrity, InterviewKind, InterviewReport, InterviewTurn } from "@/lib/types";

const VERDICT = {
  strong: { label: "Interview-ready", tone: "ok" },
  good: { label: "Good, with gaps", tone: "brand" },
  mixed: { label: "Mixed", tone: "warn" },
  not_yet: { label: "Not yet", tone: "bad" },
} as const satisfies Record<string, { label: string; tone: Tone }>;
const DIM = { communication: "Communication", structure: "Structure", depth: "Technical depth", evidence: "Evidence and impact", role_fit: "Role fit" } as const;

function Bar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${score} out of 5`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface2"><div className={`h-full rounded-full ${score >= 4 ? "bg-ok" : score === 3 ? "bg-brand" : "bg-warn"}`} style={{ width: `${score * 20}%` }} /></div>
      <span className="w-7 text-xs tabular-nums text-muted">{score}/5</span>
    </div>
  );
}

export default function Report({ r, turns, integrity, sessionId, codingEnabled, kind }: { r: InterviewReport; turns: InterviewTurn[]; integrity?: Integrity; sessionId?: number; codingEnabled?: boolean; kind?: InterviewKind }) {
  const v = VERDICT[r.verdict];
  return (
    <div className="report-view mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Interview assessment</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">Evidence. Reflection. Next steps.</h1>{r.generated_at && <p className="mt-2 text-xs text-muted">Generated {dateTime(r.generated_at)}</p>}</div><button className="btn no-print" onClick={() => window.print()}><FileDown size={14} /> Print / save PDF</button></div>
      <section className="card flex flex-wrap items-center gap-5 p-6">
        <ScoreRing score={r.overall} size={84} />
        <div className="min-w-0 flex-1">
          <Badge tone={v.tone}>{v.label}</Badge>
          <p className="mt-2 text-[15px] leading-relaxed">{r.summary}</p>
        </div>
      </section>

      {sessionId && <Recordings sessionId={sessionId} />}
      {sessionId && codingEnabled && <CodingReview sessionId={sessionId} />}
      <section className="card p-6">
        <h2 className="mb-4 text-sm font-semibold">How you did</h2>
        <ul className="space-y-3">
          {(Object.keys(DIM) as (keyof typeof DIM)[]).map((k) => (
            <li key={k} className="grid gap-1 sm:grid-cols-[170px_1fr] sm:items-start sm:gap-4">
              <div className="flex items-center justify-between sm:block"><span className="text-[13px] font-medium">{kind === "behavioral" && k === "depth" ? "Judgment and reflection" : DIM[k]}</span><span className="sm:hidden"><Bar score={r.dimensions[k].score} /></span></div>
              <div className="space-y-1"><span className="hidden sm:block"><Bar score={r.dimensions[k].score} /></span><p className="text-[13px] text-muted">{r.dimensions[k].comment}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="card p-5"><h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><TrendingUp size={15} className="text-ok" /> Strengths</h2><List items={r.strengths} /></section>
        <section className="card p-5"><h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Target size={15} className="text-warn" /> To work on</h2><List items={r.improvements} /></section>
      </div>

      {integrity?.monitored && <IntegritySection i={integrity} />}

      <section className="space-y-3">
        <div><p className="eyebrow mb-1">Supporting observations</p><h2 className="text-lg font-semibold">The moments that mattered</h2><p className="mt-1 text-xs text-muted">Exact excerpts from saved candidate turns. Times indicate when the turn was saved, not word-level audio alignment.</p></div>
        {r.evidence?.length ? r.evidence.map((e, i) => <article key={i} className="card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><Badge tone={e.category === "strength" ? "ok" : e.category === "development" ? "warn" : "neutral"}>{e.category === "strength" ? "Demonstrated strength" : e.category === "development" ? "Development opportunity" : "Observed evidence"}</Badge><a href={`#transcript-turn-${e.turn_index}`} className="flex items-center gap-1.5 text-xs text-brand"><Clock size={12} />{dateTime(e.at)} · Turn {e.turn_index + 1}</a></div><blockquote className="mt-4 whitespace-pre-wrap border-l-2 border-line2 pl-4 text-sm leading-relaxed text-muted">“{e.quote}”</blockquote><p className="mt-4 text-sm leading-relaxed">{e.assessment}</p>{e.next_step && <p className="mt-3 rounded-lg bg-surface2 p-3 text-xs leading-relaxed"><span className="font-semibold">Recommended action:</span> {e.next_step}</p>}</article>) : <p className="rounded-lg border border-dashed border-line2 p-5 text-sm text-muted">No evidence annotations are available in this report. A new detailed report can be generated after the session is completed.</p>}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Question by question</h2>
        {r.questions.map((q, i) => (
          <article key={i} className="card space-y-2 p-5">
            <div className="flex items-start justify-between gap-3"><h3 className="text-[14px] font-medium">{q.question}</h3><Bar score={q.score} /></div>
            {q.answer_summary && <p className="text-[13px] text-muted"><span className="font-medium text-fg">You said:</span> {q.answer_summary}</p>}
            <p className="text-[13px]">{q.feedback}</p>
            {q.strong_answer_covers.length > 0 && (
              <div className="rounded-lg bg-brand-soft/60 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-brand"><Lightbulb size={13} /> A strong answer covers</p>
                <ul className="list-disc space-y-0.5 pl-5 text-[13px]">{q.strong_answer_covers.map((c, j) => <li key={j}>{c}</li>)}</ul>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="mb-2 text-sm font-semibold">Before your next attempt</h2>
        <ul className="space-y-1.5">{r.practice_plan.map((p, i) => <li key={i} className="flex gap-2 text-[13px]"><Check size={14} className="mt-0.5 shrink-0 text-brand" />{p}</li>)}</ul>
      </section>

      <details open className="card p-5 text-[13px]">
        <summary className="cursor-pointer text-sm font-semibold">Full transcript</summary>
        <ol className="mt-3 space-y-2.5">{turns.map((t, i) => <li id={`transcript-turn-${i}`} key={i} className="scroll-mt-20 border-l-2 border-line pl-4 py-1"><span className="mr-3 text-xs text-muted">{dateTime(t.at)}</span><span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{t.who === "candidate" ? "You" : "Interviewer"}</span><p className="text-muted">{t.text}</p></li>)}</ol>
      </details>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return items.length ? <ul className="list-disc space-y-1.5 pl-5 text-[13px]">{items.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="text-[13px] text-muted">Nothing notable.</p>;
}

const EV_LABEL: Record<string, string> = {
  tab_hidden: "Switched tab or app", window_blur: "Clicked away from the window", fullscreen_exit: "Left full screen", copy: "Copied text", cut: "Cut text", paste: "Pasted text",
  context_menu: "Opened right-click menu", multi_screen: "Extra display connected", no_face: "Face not visible", multiple_faces: "More than one face", gaze_away: "Eyes off screen",
  head_turned: "Head turned away", camera_off: "Camera off", virtual_camera: "Virtual camera", devtools: "Developer tools suspected", reload: "Reloaded the page",
  cursor_left: "Pointer left the window", shortcut: "Used a tool or capture shortcut", window_resized: "Resized the window", focus_lost: "Window lost focus",
};

function IntegritySection({ i }: { i: Integrity }) {
  const tone = i.status === "clean" ? "bg-ok-soft text-ok" : i.status === "review" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad";
  const entries = Object.entries(i.counts ?? {});
  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} /> Integrity</h2>
        <span className={`chip ${tone}`}>{i.status === "clean" ? "Clean" : i.status === "review" ? "Worth a look" : "Flagged"} · {i.score}/100</span>
      </div>
      {entries.length === 0 ? <p className="text-[13px] text-muted">No flags. You stayed in the window, did not paste, and kept your head and eyes on the screen.</p> : (
        <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
          {entries.map(([t, n]) => <li key={t} className="flex justify-between gap-3 rounded-lg bg-surface2 px-3 py-1.5"><span>{EV_LABEL[t] ?? t}</span><span className="tabular-nums text-muted">{n}×</span></li>)}
        </ul>
      )}
      {(i.away_seconds ?? 0) > 0 && <p className="text-[13px] text-muted">About {i.away_seconds}s away from the screen in total.</p>}
      <p className="text-xs text-subtle">{i.note}</p>
    </section>
  );
}
