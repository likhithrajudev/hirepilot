"use client";

import { Brain, Code2, Briefcase, Check, ChevronLeft, FileText, Keyboard, Layers, Mic, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import MemoryPanel from "@/components/interview/MemoryPanel";
import { interviewerProfile, INTERVIEWER_BY_KIND } from "@/lib/interviewers";
import SystemCheck from "@/components/interview/SystemCheck";
import { useToast } from "@/app/providers";
import { useDialog } from "@/components/Dialog";
import { EmptyState, ErrorNote, PageHeader, ScoreRing, Skeleton, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useDeleteInterview, useInterviews, useResumes, useStartInterview, useSubscription } from "@/lib/hooks";
import { credits, INTERVIEW_COSTS } from "@/lib/plans";
import type { InterviewKind } from "@/lib/types";

const KINDS: { id: InterviewKind; title: string; blurb: string; icon: typeof Mic }[] = [
  { id: "behavioral", title: "Behavioral", blurb: "Ownership, teamwork, conflict, failure. STAR answers with real outcomes.", icon: Briefcase },
  { id: "coding", title: "Coding", blurb: "A live editor, four languages, test cases and edge cases. Explain while you build.", icon: Code2 },
  { id: "technical", title: "Technical", blurb: "Data structures, complexity and trade-offs, explained out loud.", icon: Brain },
  { id: "resume", title: "Resume deep dive", blurb: "Your own projects: what you built, why, and what went wrong.", icon: FileText },
  { id: "system_design", title: "System design", blurb: "A scoped design problem, step by step: requirements to bottlenecks.", icon: Layers },
];
const KIND_NAME = Object.fromEntries(KINDS.map((k) => [k.id, k.title])) as Record<InterviewKind, string>;

export default function InterviewsPage() {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const list = useInterviews();
  const resumes = useResumes();
  const start = useStartInterview();
  const del = useDeleteInterview();
  const [kind, setKind] = useState<InterviewKind>("behavioral");
  const [role, setRole] = useState("Software Engineer");
  const [company, setCompany] = useState("");
  const [level, setLevel] = useState("new_grad");
  const [difficulty, setDifficulty] = useState("medium");
  const [minutes, setMinutes] = useState(20);   // talking interviews are time-boxed: the interviewer asks as many questions as fit
  const [codingProblems, setCodingProblems] = useState(1);
  const [codingLanguage, setCodingLanguage] = useState("python");
  const [codingStatus, setCodingStatus] = useState<{ ready: boolean; message: string } | null>(null);
  useEffect(() => { if (kind !== "coding") return; let live = true; const check = () => { void api<{ ready: boolean; message: string }>("/interviews/coding/status").then((data) => { if (live) setCodingStatus(data); }).catch(() => { if (live) setCodingStatus({ ready: false, message: "Code runner availability could not be checked. Execution may be unavailable." }); }); }; check(); const timer = setInterval(check, 15000); return () => { live = false; clearInterval(timer); }; }, [kind]);
  const [resumeId, setResumeId] = useState<number | "">("");
  const [proctored, setProctored] = useState(true);  // on by default, like a real assessment; clearly disclosed and switchable for casual practice
  const [voice, setVoice] = useState(true);
  const sub = useSubscription();
  const creditRow = sub.data?.usage.interview;
  const cost = kind === "coding" ? INTERVIEW_COSTS.coding : voice ? INTERVIEW_COSTS.voice : INTERVIEW_COSTS.text;
  const left = sub.data?.own_key ? null : creditRow?.remaining ?? null;   // null: not metered (own key) or still loading
  const short = left !== null && left < cost;
  const [stage, setStage] = useState<"setup" | "check">("setup");
  const [ready, setReady] = useState(false);
  const onReady = useCallback((ok: boolean) => setReady(ok), []);

  const persona = INTERVIEWER_BY_KIND[kind];
  const needsResume = kind === "resume";
  const review = () => {
    if (needsResume && !resumeId) return toast("Pick a resume for the deep dive", "error");
    setReady(false); setStage("check");
  };
  const go = () => {
    start.mutate(
      { kind, role, company, level, difficulty, questions: 6, minutes, coding_problems: codingProblems, coding_language: codingLanguage, resume_id: resumeId || null, proctored, mode: voice ? "voice" : "text" },
      {
        onSuccess: (iv) => {
          try { localStorage.setItem(`hp_iv_mode_${iv.id}`, voice ? "voice" : "text"); sessionStorage.setItem(`hp_iv_go_${iv.id}`, "1"); } catch {}
          router.push(`/interviews/${iv.id}`);
        },
        onError: (e) => { if (!(e instanceof ApiError && e.paywall)) toast(e.message, "error"); }, // paywalls open the upgrade dialog on their own
      },
    );
  };

  return (
    <div className="workspace-page space-y-8">
      <PageHeader eyebrow="Prepare / Interview practice" title="Confidence comes with practice." subtitle="A focused conversation. Honest feedback. A clearer idea of what to work on next." />
      <ol aria-label="Session progress" className="flex flex-wrap gap-x-6 gap-y-3 border-b border-line pb-5 text-xs">{["Build your session", "Check your setup", "Meet your interviewer"].map((s, i) => <li key={s} aria-current={(stage === "setup" ? 0 : 1) === i ? "step" : undefined} className={`flex items-center gap-2 ${i <= (stage === "setup" ? 0 : 1) ? "font-semibold text-brand" : "text-subtle"}`}><span className={`grid h-6 w-6 place-items-center rounded-full border ${i <= (stage === "setup" ? 0 : 1) ? "border-brand bg-brand-soft" : "border-line2"}`}>{i === 0 && stage === "check" ? <Check size={12} /> : i + 1}</span>{s}</li>)}</ol>
      <div className="practice-grid"><div className="min-w-0">

      {stage === "check" ? (
        <section className="card space-y-5 p-6">
          <button className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg" onClick={() => setStage("setup")}><ChevronLeft size={15} /> Back to setup</button>
          <div><h2 className="text-lg font-semibold">System check</h2><p className="mt-1 text-sm text-muted">{voice ? "A voice interview needs a working microphone and speakers. Every required check has to pass before you can start." : "A quick check that your connection and browser are fine."}</p></div>
          <SystemCheck voice={voice} proctored={proctored} onReady={onReady} />
          <p className="rounded-lg border border-line bg-surface2 p-4 text-xs leading-relaxed text-muted">Audio recording starts automatically when you join. Your microphone (in voice mode) and AI audio are saved for playback by you and authorized platform admins. You can delete recordings from your report. Camera footage is not saved.</p>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button className="btn btn-primary h-10 px-5" onClick={go} disabled={!ready || start.isPending}><Mic size={15} /> {start.isPending ? "Preparing your interviewer…" : "Start interview"}</button>
            {!ready && <span className="text-xs text-muted">Complete the checks above to continue.</span>}
          </div>
        </section>
      ) : (
      <section className="card space-y-6 p-5 sm:p-6">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface2 p-4"><Mic size={20} className="mt-1 shrink-0 text-brand" /><div><p className="text-sm font-semibold">{persona} · {interviewerProfile(persona)?.title}</p><p className="mt-1 text-xs leading-relaxed text-muted">Your interviewer is assigned for {KIND_NAME[kind].toLowerCase()}. {interviewerProfile(persona)?.focus}</p><p className="mt-2 text-xs text-subtle">Automatic turn detection listens for a complete answer. Thoughtful pauses are welcome.</p></div></div>
        {kind === "coding" && <div className="grid gap-4 rounded-xl border border-brand/25 bg-brand-soft p-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-medium">Starting language<select className="input" value={codingLanguage} onChange={(e) => setCodingLanguage(e.target.value)}><option value="python">Python 3</option><option value="javascript">JavaScript · Node.js</option><option value="cpp">C++17</option><option value="java">Java</option></select></label><label className="space-y-2 text-xs font-medium">Coding problems<select className="input" value={codingProblems} onChange={(e) => setCodingProblems(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} {n === 1 ? "problem" : "problems"}</option>)}</select></label><p className="text-xs leading-relaxed text-muted sm:col-span-2">Your code saves automatically. Run examples, submit the full test suite, then discuss correctness and complexity with your interviewer. Additional problems are part of the same interview allowance.</p><p role="status" className={`text-xs sm:col-span-2 ${codingStatus?.ready ? "text-brand" : "text-warn"}`}>{codingStatus?.message ?? "Checking isolated code runner…"}{codingStatus && !codingStatus.ready && " Starting still uses your interview allowance; execution must be enabled before you can run or submit tests."}</p></div>}
        <div className="border-t border-line pt-6"><p className="eyebrow mb-1">01 / Focus area</p><h2 className="text-lg font-semibold">What would you like to work on?</h2></div>
        <div role="radiogroup" aria-label="Interview type" className="grid gap-3 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label key={k.id}
              className={`relative flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition focus-within:ring-2 focus-within:ring-brand ${kind === k.id ? "border-brand bg-brand-soft" : "border-line hover:bg-surface2"}`}>
              <input type="radio" name="interview-kind" value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} className="sr-only" />
              <k.icon size={18} className={kind === k.id ? "mt-0.5 text-brand" : "mt-0.5 text-muted"} />
              <span><span className="block text-sm font-semibold">{k.title}</span><span className="mt-0.5 block text-[13px] text-muted">{k.blurb}</span></span>
            </label>
          ))}
        </div>

        <div className="border-t border-line pt-6"><p className="eyebrow mb-1">02 / Make it yours</p><h2 className="text-lg font-semibold">Set the scene</h2></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1"><span className="label">Role</span><input className="input w-full" value={role} maxLength={200} onChange={(e) => setRole(e.target.value)} /></label>
          <label className="space-y-1"><span className="label">Company (optional)</span><input className="input w-full" value={company} maxLength={200} placeholder="e.g. Razorpay" onChange={(e) => setCompany(e.target.value)} /></label>
          <label className="space-y-1"><span className="label">Level</span>
            <select className="input w-full" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="intern">Internship</option><option value="new_grad">New graduate</option><option value="junior">1-2 years</option><option value="mid">3-5 years</option>
            </select>
          </label>
          <label className="space-y-1"><span className="label">{needsResume ? "Resume (required)" : "Resume to draw on (optional)"}</span>
            <select className="input w-full" value={resumeId} onChange={(e) => setResumeId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">{needsResume ? "Choose a resume…" : "None"}</option>
              {(resumes.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <div className="space-y-1"><span className="label">Difficulty</span>
            <div className="seg" role="group" aria-label="Difficulty">{["easy", "medium", "hard"].map((d) => <button key={d} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)} className="capitalize">{d}</button>)}</div>
          </div>
          {kind !== "coding" && <div className="space-y-1"><span className="label" id="length-label">Length</span><div className="seg" role="group" aria-labelledby="length-label">{[10, 15, 20, 30].map((m) => <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m} min</button>)}</div></div>}
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4">
          <input type="checkbox" className="mt-1" checked={proctored} onChange={(e) => setProctored(e.target.checked)} />
          <span><span className="block text-sm font-semibold">Integrity checks (on by default, like a real assessment)</span>
            <span className="mt-0.5 block text-[13px] text-muted">Looks for tab switches, pasting, extra displays and, with your camera, face and eye position. Camera analysis happens on your device; camera footage is not recorded or uploaded. Nothing is shown while you are interviewing: the result appears in your report. Turn this off for casual practice.</span></span>
        </label>

        <div role="radiogroup" aria-label="Interview mode" className="grid gap-3 sm:grid-cols-2">
          {[{ v: true, title: "Voice interview", blurb: "Talk to the interviewer like a video call. Needs a microphone and speakers.", icon: Mic, price: INTERVIEW_COSTS.voice }, { v: false, title: "Text interview", blurb: "Type your answers. No microphone needed.", icon: Keyboard, price: INTERVIEW_COSTS.text }].map((m) => (
            <label key={m.title} className={`cursor-pointer focus-within:ring-2 focus-within:ring-brand flex items-start gap-3 rounded-lg border p-4 text-left transition ${voice === m.v ? "border-brand bg-brand-soft" : "border-line hover:bg-surface2"}`}>
              <input type="radio" name="interview-mode" checked={voice === m.v} onChange={() => setVoice(m.v)} className="sr-only" />
              <m.icon size={18} className={voice === m.v ? "mt-0.5 text-brand" : "mt-0.5 text-muted"} />
              <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 text-sm font-semibold">{m.title}<span className="chip bg-surface2 text-muted">{kind === "coding" ? credits(INTERVIEW_COSTS.coding) : credits(m.price)}</span></span><span className="mt-0.5 block text-[13px] text-muted">{m.blurb}</span></span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button disabled={!role.trim() || (needsResume && !resumeId) || short} className="btn btn-primary h-10 px-5" onClick={review}><Mic size={15} /> Continue to system check</button>
          <span className="text-xs text-muted">{short ? <>You have {left} interview credit{left === 1 ? "" : "s"} left this month and this needs {cost}. <Link href="/settings?section=billing" className="font-semibold text-brand underline">See plans</Link></> : <>Uses {credits(cost)}{left !== null ? ` of your ${left} left this month` : ""}, only after the check passes. Voice works in Chrome, Edge and Safari.</>}</span>
        </div>
      </section>
      )}

      </div><aside className="practice-aside rounded-xl border border-line bg-surface p-6">
        <p className="eyebrow">Your session at a glance</p><span className="mt-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand"><Mic size={23} /></span>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">{KIND_NAME[kind]}</h2><p className="mt-1 text-sm text-muted">{role || "Your next role"}{company ? ` at ${company}` : ""}</p>
        <dl className="mt-6 space-y-3 border-y border-line py-5 text-[13px]">{[["Interviewer", persona || "Surprise me"], ["Style", interviewerProfile(persona)?.style ?? "Varied"], ["Format", voice ? "Voice" : "Text"], [kind === "coding" ? "Coding problems" : "Length", kind === "coding" ? String(codingProblems) : `${minutes} minutes`], ["Difficulty", difficulty], ["Integrity checks", proctored ? "Enabled" : "Off"], ["Cost", credits(cost)]].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="font-medium capitalize">{v}</dd></div>)}</dl>
        <p className="mt-5 text-xs leading-relaxed text-muted">Use real examples. Explain your thinking. It’s okay to take a moment before you answer.</p><p className="mt-4 text-xs leading-relaxed text-subtle">Your allowance is used only when you start, after the system check.</p>
      </aside></div>
      <p className="text-xs leading-relaxed text-subtle">Your saved transcript and report may be reviewed by platform administrators for support, quality, and the requested interview analytics.</p>
      <MemoryPanel />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Your interviews</h2>
        {list.isError && <ErrorNote>{list.error.message} <button className="font-semibold underline" onClick={() => void list.refetch()}>Try again</button></ErrorNote>}
        {list.isLoading ? <Skeleton className="h-20" />
          : list.isError && !list.data ? null : !list.data?.length ? <EmptyState icon={<Mic size={20} />} title="No interviews yet" body="Pick a type above and have your first one. Most people improve noticeably by the third." />
          : (
            <ul className="space-y-2">
              {list.data.map((s) => (
                <li key={s.id} className="card card-hover flex items-center gap-4 p-4">
                  <ScoreRing score={s.overall} size={44} />
                  <Link href={`/interviews/${s.id}`} className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{KIND_NAME[s.kind]} · {s.role}{s.company ? ` at ${s.company}` : ""}</span>
                    <span className="text-xs text-muted">{timeAgo(s.created_at)} · {s.answered} answered · {s.status === "active" ? "in progress" : s.overall === null ? "no report yet" : "report ready"}</span>
                  </Link>
                  <button disabled={del.isPending} className="btn btn-danger btn-icon" aria-label="Delete interview"
                    onClick={async () => { if (await dialog.confirm({ title: "Delete this interview?", body: "The transcript and report are removed. It still counts toward this month's allowance.", confirmLabel: "Delete", danger: true })) del.mutate(s.id, { onError: (e) => toast(e.message, "error") }); }}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
