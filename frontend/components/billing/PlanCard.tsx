"use client";

import { Gauge } from "lucide-react";
import Link from "next/link";
import { useSubscription } from "@/lib/hooks";
import UsageBar from "./UsageBar";

/** Sidebar footer: which plan you are on, and the one allowance you are closest to running out of. */
export default function PlanCard({ collapsed }: { collapsed: boolean }) {
  const { data } = useSubscription();
  if (!data) return null;
  const rows = Object.values(data.usage).filter((r) => r.limit !== null && r.limit > 0 && !r.unmetered_by_own_key);
  const tight = rows.sort((a, b) => b.used / (b.limit ?? 1) - a.used / (a.limit ?? 1))[0];
  const href = "/settings?section=billing";
  if (collapsed) {
    return <Link href={href} aria-label={`${data.plan.name} plan. Open billing`} title={`${data.plan.name} plan`} className="grid h-10 w-full place-items-center rounded-lg text-subtle transition-colors hover:bg-surface2 hover:text-fg"><Gauge size={17} /></Link>;
  }
  return (
    <Link href={href} className="block rounded-lg border border-line p-3 transition-colors hover:border-line2 hover:bg-surface2/60">
      <div className="flex items-center justify-between text-[13px] font-semibold"><span>{data.plan.name} plan</span>{data.plan.id !== "captain" && data.plan.id !== "fleet" && <span className="text-xs font-medium text-brand">Upgrade</span>}</div>
      {tight && <div className="mt-2.5"><UsageBar row={tight} compact /></div>}
    </Link>
  );
}
