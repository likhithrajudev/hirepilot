"use client";

import { Check, Loader2 } from "lucide-react";

/** Shown over a blurred screen while an interview wraps up, so the few seconds of saving and scoring never look like a hang. */
export const ENDING_STEPS = ["Saving your code and answers", "Saving your audio recording", "Closing the camera and releasing full screen", "Writing your feedback"];
const DETAIL = ["Making sure nothing you wrote is lost.", "Uploading the last part of the conversation.", "Switching off monitoring and leaving full screen.", "Reading your answers and scoring them. This usually takes 10 to 20 seconds."];

export default function EndingOverlay({ step }: { step: number }) {
  const i = Math.min(Math.max(step, 0), ENDING_STEPS.length - 1);
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[95] grid place-items-center bg-black/55 p-6 text-white backdrop-blur-xl">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/60 p-6 shadow-2xl">
        <div className="flex items-center gap-3"><Loader2 size={22} className="shrink-0 animate-spin text-[#96b8ff]" /><div><p className="text-[15px] font-semibold">Wrapping up your interview</p><p className="mt-0.5 text-[13px] text-white/65">{DETAIL[i]}</p></div></div>
        <ol className="mt-5 space-y-2.5">
          {ENDING_STEPS.map((label, n) => (
            <li key={label} className={`flex items-center gap-2.5 text-[13px] ${n < i ? "text-white/55" : n === i ? "font-medium text-white" : "text-white/30"}`}>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${n < i ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300" : n === i ? "border-[#96b8ff]/50 text-[#96b8ff]" : "border-white/15"}`}>{n < i ? <Check size={12} /> : n === i ? <Loader2 size={11} className="animate-spin" /> : null}</span>
              {label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
