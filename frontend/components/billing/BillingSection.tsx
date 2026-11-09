"use client";

import { CheckCircle2, ExternalLink, FlaskConical, TriangleAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/providers";
import { useDialog } from "@/components/Dialog";
import { Row, SectionCard } from "@/components/settings-ui";
import { Skeleton } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import { billingKeys, useBillingPortal, useCancelPlan, useInvoices, useKeepPlan, useSubscription } from "@/lib/hooks";
import { CURRENCIES, guessCurrency, limitText, money, perMonth, planById, PLANS, priceOf, type Currency, type Interval } from "@/lib/plans";
import { useUpgrade } from "@/lib/upgrade";
import UsageBar from "./UsageBar";

const KIND: Record<string, string> = { payment: "Payment", renewal: "Renewal", plan_change: "Plan change", cancel: "Cancellation", payment_failed: "Payment failed", refund: "Refund" };

export default function BillingSection() {
  const toast = useToast();
  const { confirm } = useDialog();
  const router = useRouter();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const sub = useSubscription();
  const invoices = useInvoices();
  const cancel = useCancelPlan();
  const keep = useKeepPlan();
  const portal = useBillingPortal();
  const { upgrade, pending } = useUpgrade();
  const [interval, setBilling] = useState<Interval>("month");
  const [currency, setCurrency] = useState<Currency>("USD");
  useEffect(() => setCurrency(guessCurrency()), []);

  const data = sub.data;
  const s = data?.subscription ?? null;
  const plan = planById(data?.plan.id ?? "cadet");
  const portalOnly = data?.mode === "stripe" && !!s?.has_portal;

  // A pricing-page button sends you here with ?plan=...: confirm the change instead of charging on arrival.
  const handled = useRef(false);
  useEffect(() => {
    const want = sp.get("plan");
    if (!want || !data || handled.current || !["pilot", "captain"].includes(want)) return;
    handled.current = true;
    const i = (sp.get("interval") === "year" ? "year" : "month") as Interval;
    const c = (sp.get("currency") === "INR" ? "INR" : "USD") as Currency;
    router.replace("/settings?section=billing", { scroll: false });
    if (want === data.plan.id && s?.interval === i) return;
    const target = planById(want);
    void confirm({
      title: `Switch to ${target.name}?`,
      body: `${money(priceOf(target, c, i) ?? 0, c)} billed ${i === "year" ? "yearly" : "monthly"}.${data.mode === "test" ? " Test mode: nothing is charged." : " You will be taken to Stripe to pay."}`,
      confirmLabel: data.mode === "stripe" ? "Continue to payment" : `Switch to ${target.name}`,
    }).then((ok) => { if (ok) void upgrade(want, i, c); });
  }, [sp, data, s, confirm, router, upgrade]);

  // Coming back from Stripe: the webhook can lag the redirect by a few seconds, so poll briefly.
  useEffect(() => {
    if (sp.get("checkout") !== "success") return;
    toast("Payment received. Your plan updates in a few seconds.", "info");
    router.replace("/settings?section=billing", { scroll: false });
    let n = 0;
    const t = setInterval(() => { void qc.invalidateQueries({ queryKey: billingKeys.subscription }); if (++n >= 6) clearInterval(t); }, 2500);
    return () => clearInterval(t);
  }, [sp, qc, router, toast]);

  const lapses = s?.cancel_at_period_end;
  const resetDate = data ? new Date(data.resets_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";

  return (
    <>
      {data?.mode === "test" && (
        <div role="note" className="flex gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] leading-relaxed text-warn">
          <FlaskConical size={16} className="mt-0.5 shrink-0" />
          <span><strong className="font-semibold">Test mode.</strong> Plan changes apply instantly and nothing is charged. Real payments switch on when Stripe keys are added to the server.</span>
        </div>
      )}

      <SectionCard title="Your plan" actions={s && <span className={`chip ${s.status === "past_due" ? "bg-bad-soft text-bad" : lapses ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>{s.status === "past_due" ? "Payment failed" : lapses ? "Ending" : "Active"}</span>}>
        {sub.isLoading ? <Skeleton className="h-16 w-full" /> : sub.isError ? (
          <p className="text-sm text-bad">Could not load your plan. <button className="underline" onClick={() => sub.refetch()}>Try again</button></p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-2xl font-semibold tracking-tight">{plan.name}</div>
                <p className="mt-1 text-sm text-muted">
                  {!s ? "Free. Upgrade whenever you need more." : s.status === "past_due" ? "Your last payment did not go through. Update your payment method to keep this plan."
                    : lapses ? `Ends on ${fmtDate(s.current_period_end)}. You will not be charged again.`
                    : `${money(s.amount / 100, s.currency)} per ${s.interval}. Renews on ${fmtDate(s.current_period_end)}.`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {portalOnly && <button className="btn" disabled={portal.isPending} onClick={() => portal.mutate(undefined, { onSuccess: (r) => window.location.assign(r.url), onError: (e) => toast(e.message, "error") })}><ExternalLink size={14} /> Manage billing</button>}
                {s && data?.can_manage && (lapses ? (
                  <button className="btn" disabled={keep.isPending} onClick={() => keep.mutate(undefined, { onSuccess: () => toast(`${plan.name} will keep renewing`), onError: (e) => toast(e.message, "error") })}>Keep my plan</button>
                ) : (
                  <button className="btn btn-danger" disabled={cancel.isPending} onClick={async () => {
                    if (await confirm({ title: `Cancel ${plan.name}?`, body: `You keep every ${plan.name} feature until ${fmtDate(s.current_period_end)}, then move to Cadet. Nothing you created is deleted.`, confirmLabel: "Cancel plan", cancelLabel: "Keep plan", danger: true }))
                      cancel.mutate(undefined, { onSuccess: () => toast(`${plan.name} will end on ${fmtDate(s.current_period_end)}`, "info"), onError: (e) => toast(e.message, "error") });
                  }}>Cancel plan</button>
                ))}
              </div>
            </div>
            {data && !data.can_manage && <p className="mt-4 text-xs text-subtle">Only a workspace owner can change the plan.</p>}
          </>
        )}
      </SectionCard>

      <SectionCard title="Usage" description={data ? `Resets on ${resetDate}. AI actions on your own OpenAI key are never counted.` : undefined}>
        {!data ? <Skeleton className="h-40 w-full" /> : <div className="space-y-5">{Object.entries(data.usage).map(([k, row]) => <UsageBar key={k} row={row} />)}</div>}
      </SectionCard>

      <SectionCard title="Change plan" actions={
        <div className="flex gap-2">
          <div className="seg" role="group" aria-label="Billing interval">{(["month", "year"] as const).map((i) => <button key={i} aria-pressed={interval === i} onClick={() => setBilling(i)}>{i === "month" ? "Monthly" : "Yearly"}</button>)}</div>
          <div className="seg" role="group" aria-label="Currency">{CURRENCIES.map((c) => <button key={c} aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c}</button>)}</div>
        </div>}>
        {portalOnly && <p className="mb-4 text-[13px] text-muted">Plan changes for a Stripe subscription happen in the billing portal, so prorations are handled correctly.</p>}
        <ul className="divide-y divide-line">
          {PLANS.map((p) => {
            const here = p.id === plan.id;
            const price = perMonth(p, currency, interval);
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4 first:pt-0 last:pb-0">
                <div className="min-w-[150px] flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">{p.name}{here && <span className="chip bg-brand-soft text-brand">Current</span>}{p.recommended && !here && <span className="chip bg-surface2 text-muted">Recommended</span>}</div>
                  <div className="mt-0.5 text-xs text-muted">{limitText("tailor", p.limits.tailor)} · {limitText("review", p.limits.review)}</div>
                </div>
                <div className="w-28 text-right text-sm tabular-nums">{p.contact_sales ? <span className="text-muted">Custom</span> : <><span className="font-semibold">{money(price ?? 0, currency)}</span><span className="text-xs text-muted"> / mo</span></>}</div>
                <div className="w-36 text-right">
                  {p.contact_sales ? <a className="btn btn-sm" href="mailto:sales@hirepilot.example">Talk to sales</a>
                    : p.id === "cadet" ? (here ? null : <span className="text-xs text-subtle">Cancel your plan to return</span>)
                    : here && s?.interval === interval ? <CheckCircle2 size={16} className="ml-auto text-ok" aria-label="Your current plan" />
                    : <button className="btn btn-sm btn-primary" disabled={pending || portalOnly || !data?.can_manage} onClick={() => upgrade(p.id, interval, currency)}>{here ? `Switch to ${interval === "year" ? "yearly" : "monthly"}` : p.rank > plan.rank ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}</button>}
                </div>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <SectionCard title="Billing history">
        {invoices.isLoading ? <Skeleton className="h-24 w-full" /> : !invoices.data?.length ? <p className="text-sm text-muted">Nothing yet. Payments and plan changes will appear here.</p> : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead><tr className="text-xs text-subtle"><th scope="col" className="px-2 pb-2 font-medium">Date</th><th scope="col" className="px-2 pb-2 font-medium">Activity</th><th scope="col" className="px-2 pb-2 text-right font-medium">Amount</th><th scope="col" className="px-2 pb-2 font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-line">
                {invoices.data.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-2 py-2.5 text-muted">{fmtDate(e.created_at)}</td>
                    <td className="px-2 py-2.5"><span className="font-medium">{KIND[e.kind] ?? e.kind}</span>{e.plan && <span className="text-muted"> · {planById(e.plan).name}</span>}{e.url && <> · <a className="text-brand hover:underline" href={e.url} target="_blank" rel="noreferrer">Receipt</a></>}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{e.amount ? money(e.amount / 100, e.currency as Currency) : "–"}</td>
                    <td className="px-2 py-2.5"><span className={`chip ${e.status === "failed" ? "bg-bad-soft text-bad" : e.status === "test" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>{e.status === "failed" && <TriangleAlert size={10} />}{e.status === "test" ? "Test" : e.status === "failed" ? "Failed" : "Paid"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
