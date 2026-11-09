"use client";

import { Check, Gauge, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/Dialog";
import type { Paywall } from "@/lib/api";
import { useSubscription } from "@/lib/hooks";
import { CURRENCIES, guessCurrency, limitText, money, perMonth, planById, PLANS, type Currency, type Interval, type MeteredKey } from "@/lib/plans";
import { useUpgrade } from "@/lib/upgrade";
import UsageBar from "./UsageBar";

/** Opens whenever the server answers 402: says exactly what was hit, and offers the plans that fix it. */
export default function UpgradeDialog({ paywall, onClose }: { paywall: Paywall | null; onClose: () => void }) {
  const sub = useSubscription();
  const { upgrade, pending } = useUpgrade();
  const [currency, setCurrency] = useState<Currency>(() => guessCurrency());
  const [interval, setBilling] = useState<Interval>("month");
  const current = planById(paywall?.plan ?? "cadet");
  const feature = paywall?.feature as MeteredKey | "templates" | undefined;
  const options = PLANS.filter((p) => p.rank > current.rank && !p.contact_sales);
  const row = feature && feature !== "templates" ? sub.data?.usage[feature] : undefined;
  const canManage = sub.data?.can_manage ?? true;

  return (
    <Modal
      open={!!paywall} onClose={onClose} size="md" icon={<Lock size={18} />}
      title={paywall?.code === "plan_required" ? "Available on a higher plan" : "You have reached your plan limit"}
      description={paywall?.message}
      footer={<><Link href="/pricing" className="mr-auto text-[13px] font-medium text-brand hover:underline" onClick={onClose}>Compare all plans</Link><button className="btn" onClick={onClose}>Not now</button></>}
    >
      <div className="space-y-4 pb-4 pt-1">
        {row && <div className="rounded-lg border border-line bg-surface2/60 p-3.5"><UsageBar row={row} /><p className="mt-2 text-xs text-subtle">Resets on the 1st of next month{row.period === "total" ? " (this one is a cap on how many you can keep)" : ""}.</p></div>}
        {paywall?.code === "quota_exceeded" && feature && feature !== "templates" && ["tailor", "ats_check", "review", "apply_kit"].includes(feature) && (
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted"><Gauge size={15} className="mt-0.5 shrink-0 text-subtle" />Prefer not to upgrade? Add your own OpenAI key in Settings and AI actions are not counted against your plan.</p>
        )}
        <div className="flex items-center justify-between">
          <div className="seg" role="group" aria-label="Billing interval">
            {(["month", "year"] as const).map((i) => <button key={i} aria-pressed={interval === i} onClick={() => setBilling(i)}>{i === "month" ? "Monthly" : "Yearly · 2 months free"}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Currency">{CURRENCIES.map((c) => <button key={c} aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c}</button>)}</div>
        </div>
        {options.length === 0 && <p className="text-sm text-muted">You are on the highest self-serve plan. For more, <a className="font-medium text-brand hover:underline" href="mailto:sales@hirepilot.example">talk to us about Fleet</a>.</p>}
        <ul className="space-y-2.5">
          {options.map((p) => (
            <li key={p.id} className={`rounded-xl border p-4 ${p.id === paywall?.upgrade_to ? "border-brand bg-brand-soft/40" : "border-line"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">{p.name}{p.id === paywall?.upgrade_to && <span className="chip bg-brand-soft text-brand">Fixes this</span>}</div>
                  <div className="mt-0.5 text-xs text-muted">{feature && feature !== "templates" ? limitText(feature, p.limits[feature]) : p.tagline}</div>
                </div>
                <div className="text-right"><div className="text-lg font-semibold tabular-nums">{money(perMonth(p, currency, interval) ?? 0, currency)}<span className="text-xs font-normal text-muted"> / mo</span></div>{interval === "year" && <div className="text-[11px] text-subtle">billed yearly</div>}</div>
              </div>
              <ul className="mt-3 space-y-1">{p.highlights.slice(0, 2).map((h) => <li key={h} className="flex gap-2 text-xs text-muted"><Check size={13} className="mt-px shrink-0 text-ok" />{h}</li>)}</ul>
              <button className="btn btn-primary mt-3 w-full" disabled={pending || !canManage} onClick={async () => { if ((await upgrade(p.id, interval, currency)) === "applied") onClose(); }}>
                {pending ? "Working…" : `Upgrade to ${p.name}`}
              </button>
            </li>
          ))}
        </ul>
        {!canManage && <p className="text-xs text-subtle">Only a workspace owner can change the plan. Ask them to upgrade.</p>}
      </div>
    </Modal>
  );
}
