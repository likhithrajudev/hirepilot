"use client";

import { ChevronLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/providers";
import Report from "@/components/interview/Report";
import Room from "@/components/interview/Room";
import EndingOverlay from "@/components/interview/EndingOverlay";
import { ErrorNote, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { keys, useInterview } from "@/lib/hooks";
import { useQueryClient } from "@tanstack/react-query";

export default function InterviewPage() {
  const id = Number(useParams<{ id: string }>().id) || 0;
  const { data: iv, error } = useInterview(id);
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [building, setBuilding] = useState(false);

  const showReport = async () => {
    if (building) return;
    setBuilding(true);
    try {
      await api(`/interviews/${id}/finish`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: keys.interview(id) });
      qc.invalidateQueries({ queryKey: keys.interviews });
      qc.invalidateQueries({ queryKey: keys.interviewMemory });
    } catch (e) { toast(e instanceof ApiError ? e.message : "Could not build the report", "error"); router.replace("/interviews"); }
    finally { setBuilding(false); }
  };

  if (error) return <div className="mx-auto max-w-xl px-5 py-10"><ErrorNote>{error instanceof ApiError && error.status === 404 ? "That interview does not exist." : "Could not load the interview."}</ErrorNote></div>;
  if (!iv) return <div className="mx-auto max-w-5xl space-y-4 px-5 py-8"><Skeleton className="h-8 w-60" /><Skeleton className="h-[480px]" /></div>;

  const inRoom = !iv.report && !building && !(iv.status === "done" && !iv.coding_enabled && !iv.turns.some((t) => t.who === "candidate"));
  if (inRoom) return <Room iv={iv} onFinished={showReport} />;   // the room is full screen: no page link or padding behind it

  return (
    <div className="space-y-5 px-5 py-6">
      <Link href="/interviews" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft size={15} /> All interviews</Link>
      {iv.report ? <Report kind={iv.kind} codingEnabled={iv.coding_enabled} sessionId={id} r={iv.report} turns={iv.turns} integrity={iv.integrity} />
        : building ? <EndingOverlay step={3} />
        : iv.status === "done" && !iv.coding_enabled && !iv.turns.some((t) => t.who === "candidate") ? <ErrorNote>This interview ended before any answers.</ErrorNote>
        : <Room iv={iv} onFinished={showReport} />}
    </div>
  );
}
