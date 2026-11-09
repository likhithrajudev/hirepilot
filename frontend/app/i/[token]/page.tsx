"use client";

import { Camera, FileText, Mic, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Brand from "@/components/Brand";
import { ErrorNote, Skeleton } from "@/components/ui";
import { api, ApiError, json } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { InviteInfo } from "@/lib/teams";

export default function Invite() {
  const token = useParams<{ token: string }>().token;
  const router = useRouter();
  const { status } = useAuth();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  useEffect(() => { void api<InviteInfo>(`/invites/${token}`).then(setInfo).catch((e) => setError(e instanceof ApiError && e.status === 404 ? "This invite link is not valid. Ask the team for a new one." : "Could not load this invite. Try again.")); }, [token]);
  const next = encodeURIComponent(`/i/${token}`);
  const go = async (kind: "interview" | "assessment") => {
    setBusy(kind); setError("");
    try {
      if (kind === "interview") { const r = await api<{ session_id: number }>(`/invites/${token}/interview`, json({ mode, consent_monitoring: consent })); router.push(`/interviews/${r.session_id}`); }
      else { const r = await api<{ attempt_id: number }>(`/invites/${token}/assessment`, json({})); router.push(`/a/${r.attempt_id}`); }
    } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong. Try again."); setBusy(""); }
  };
  const authed = status === "authed";
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-10">
      <div className="mb-8"><Brand /></div>
      {error && !info ? <ErrorNote>{error}</ErrorNote> : !info ? <Skeleton className="h-72" /> : (
        <div className="space-y-6">
          <div><p className="eyebrow">You are invited</p><h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight">{info.first_name ? `Hi ${info.first_name}, ` : ""}{info.company || (info.invited_by ? `${info.invited_by}'s team` : "a hiring team")} would like to talk to you about the {info.role} role.</h1></div>
          {!info.open && <ErrorNote>This role is not taking interviews right now.</ErrorNote>}
          <section className="card space-y-3 p-5 text-[14px]"><h2 className="font-semibold">What to expect</h2>
            <ul className="space-y-2.5 text-muted"><li className="flex gap-3"><Mic size={16} className="mt-0.5 shrink-0 text-brand" /><span>A {info.minutes}-minute {info.type.toLowerCase()} conversation with {info.interviewer}, an AI interviewer. It listens, asks follow-ups, and you can answer by voice or by typing.</span></li>
              {info.assessment && <li className="flex gap-3"><FileText size={16} className="mt-0.5 shrink-0 text-brand" /><span>A {info.assessment.duration_min}-minute assessment: {info.assessment.title}. You can take it any time before or after the interview.</span></li>}
              <li className="flex gap-3"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand" /><span>The AI gives the team a score, a written summary and short quotes from your answers, plus a suggested next step. People make the decision.</span></li>
              <li className="flex gap-3"><Camera size={16} className="mt-0.5 shrink-0 text-brand" /><span>Your voice is recorded and saved for you; the team does not receive the recording. Camera video is never recorded or uploaded.</span></li></ul></section>
          {info.monitored && <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4 text-[13px]"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span><span className="block font-semibold">Allow integrity checks (optional)</span><span className="mt-0.5 block text-muted">The team asked for checks on tab switching, pasting and, with your camera, face and eye position. They run on your device and the team sees only a summary of signals, never video. If you do not agree, the interview still goes ahead without them and the team will see that it was not monitored.</span></span></label>}
          {status === "loading" ? <Skeleton className="h-24" /> : !authed ? (
            <div className="space-y-2"><p className="text-sm text-muted">You need a free HirePilot account so your answers and report stay yours.</p><div className="flex flex-wrap gap-2"><Link href={`/signup?next=${next}`} className="btn btn-primary">Create an account</Link><Link href={`/login?next=${next}`} className="btn">Sign in</Link></div></div>
          ) : (
            <div className="space-y-4">
              {info.interview?.done ? <p className="rounded-lg border border-ok/30 bg-ok-soft px-4 py-2.5 text-sm text-ok">You have completed the interview. Thank you.</p> : (
                <div className="space-y-3"><div role="radiogroup" aria-label="How will you answer?" className="grid gap-2 sm:grid-cols-2">{([["voice", "Talk it through", "Needs a microphone and speakers"], ["text", "Type my answers", "No microphone needed"]] as const).map(([m, t, d]) => <label key={m} className={`cursor-pointer rounded-xl border-[1.5px] p-3.5 text-[13px] ${mode === m ? "border-brand bg-brand-soft" : "border-line hover:bg-surface2"}`}><input type="radio" name="mode" className="sr-only" checked={mode === m} onChange={() => setMode(m)} /><span className="block font-semibold">{t}</span><span className="text-muted">{d}</span></label>)}</div>
                  <button className="btn btn-primary !h-11 !px-6" disabled={!info.open || !!busy} onClick={() => void go("interview")}>{info.interview?.session_id ? "Continue your interview" : "Start the interview"}</button></div>)}
              {info.assessment && (info.attempt?.done ? <p className="rounded-lg border border-ok/30 bg-ok-soft px-4 py-2.5 text-sm text-ok">You have submitted the assessment.</p> : <button className="btn !h-11" disabled={!info.open || !!busy} onClick={() => void go("assessment")}>{info.attempt?.attempt_id ? "Continue the assessment" : "Start the assessment"}</button>)}
              {error && <p role="alert" className="text-sm text-bad">{error}</p>}</div>)}
        </div>)}
    </main>
  );
}
