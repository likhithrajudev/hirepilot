"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { CURRENCIES, INTERVIEW_COSTS, METERED, PLANS, credits, guessCurrency, limitText, money, perMonth, priceOf, type Currency, type Interval, type PlanDef } from "@/lib/plans";

const SALES = "mailto:sales@hirepilot.example?subject=HirePilot%20Fleet";

function ctaFor(p: PlanDef, authed: boolean, interval: Interval, currency: Currency): { href: string; label: string } {
  if (p.contact_sales) return { href: SALES, label: "Talk to sales" };
  if (p.id === "cadet") return authed ? { href: "/home", label: "Open the app" } : { href: "/signup", label: "Start free" };
  const billing = `/settings?section=billing&plan=${p.id}&interval=${interval}&currency=${currency}`;
  return { href: authed ? billing : `/signup?next=${encodeURIComponent(billing)}`, label: `Get ${p.name}` };
}

export default function PricingSection({ comparison = false, headingLevel = 2 }: { comparison?: boolean; headingLevel?: 1 | 2 }) {
  const { status } = useAuth();
  const [interval, setBilling] = useState<Interval>("year");
  const [currency, setCurrency] = useState<Currency>("USD");
  useEffect(() => setCurrency(guessCurrency()), []);
  const H = headingLevel === 1 ? "h1" : "h2";
  const authed = status === "authed";

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-24">
      <div className="mx-auto max-w-2xl text-center">
        <H id="pricing-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Simple pricing that grows with your search</H>
        <p className="mt-4 text-base leading-relaxed text-muted">Start free. Upgrade when you are applying in earnest. Cancel any time and keep everything you made.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <div className="seg" role="group" aria-label="Billing interval">
            <button aria-pressed={interval === "month"} onClick={() => setBilling("month")}>Monthly</button>
            <button aria-pressed={interval === "year"} onClick={() => setBilling("year")}>Yearly <span className="ml-1 text-ok">2 months free</span></button>
          </div>
          <div className="seg" role="group" aria-label="Currency">{CURRENCIES.map((c) => <button key={c} aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c}</button>)}</div>
        </div>
      </div>

      <ul className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const cta = ctaFor(p, authed, interval, currency);
          const per = perMonth(p, currency, interval);
          const yearly = priceOf(p, currency, "year");
          return (
            <li key={p.id} className={`relative flex flex-col rounded-2xl border bg-surface p-6 ${p.recommended ? "border-brand shadow-[0_0_0_1px_var(--brand)]" : "border-line"}`}>
              {p.recommended && <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold tracking-wide text-brand-fg">Recommended</span>}
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 min-h-[2.5rem] text-sm leading-snug text-muted">{p.audience}</p>
              <div className="mt-5 flex items-baseline gap-1.5">
                {p.contact_sales ? <span className="text-3xl font-semibold tracking-tight">Custom</span> : <>
                  <span className="text-4xl font-semibold tracking-tight tabular-nums">{money(per ?? 0, currency)}</span>
                  <span className="text-sm text-muted">{per === 0 ? "forever" : "/ month"}</span></>}
              </div>
              <p className="mt-1 h-5 text-xs text-subtle">{!p.contact_sales && per !== 0 && interval === "year" && yearly ? `Billed ${money(yearly, currency)} per year` : ""}</p>
              <Link href={cta.href} className={`btn mt-5 !h-11 w-full ${p.recommended ? "btn-primary" : ""}`}>{cta.label}</Link>
              <ul className="mt-6 space-y-2.5 border-t border-line pt-6 text-sm">
                {p.highlights.map((h) => <li key={h} className="flex gap-2.5 leading-snug"><Check size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />{h}</li>)}
                <li className="flex gap-2.5 leading-snug text-muted"><Check size={16} className="mt-0.5 shrink-0 text-subtle" aria-hidden />{limitText("tailor", p.limits.tailor)} of AI tailoring</li>
                <li className="flex gap-2.5 leading-snug text-muted"><Check size={16} className="mt-0.5 shrink-0 text-subtle" aria-hidden />{limitText("review", p.limits.review)}</li>
              </ul>
            </li>
          );
        })}
      </ul>
      <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed text-subtle">
        AI is included on Pilot and above. On any plan you can add your own OpenAI key in Settings, and your AI actions are not counted against the limits.
      </p>

      {comparison && (
        <div className="mt-20">
          <h2 className="text-2xl font-semibold tracking-tight">Compare plans in detail</h2>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <caption className="sr-only">What each plan includes</caption>
              <thead>
                <tr className="border-b border-line bg-surface2/60">
                  <th scope="col" className="sticky left-0 bg-surface2 px-4 py-3 font-medium text-muted">Feature</th>
                  {PLANS.map((p) => <th key={p.id} scope="col" className="px-4 py-3 font-semibold">{p.name}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {METERED.map((m) => (
                  <tr key={m.key}>
                    <th scope="row" className="sticky left-0 bg-surface px-4 py-3 font-medium">{m.label}</th>
                    {PLANS.map((p) => <td key={p.id} className="px-4 py-3 tabular-nums text-muted">{p.limits[m.key] === null ? "Unlimited" : p.limits[m.key]!.toLocaleString()}{m.period === "month" && p.limits[m.key] !== null ? " / mo" : ""}</td>)}
                  </tr>
                ))}
                <tr><th scope="row" className="sticky left-0 bg-surface px-4 py-3 font-medium">ATS-safe templates</th>{PLANS.map((p) => <td key={p.id} className="px-4 py-3 text-muted">{p.templates.length} of 5</td>)}</tr>
                <tr><th scope="row" className="sticky left-0 bg-surface px-4 py-3 font-medium">Seats</th>{PLANS.map((p) => <td key={p.id} className="px-4 py-3 text-muted">{p.seats === null ? "Per agreement" : p.seats}</td>)}</tr>
                <tr><th scope="row" className="sticky left-0 bg-surface px-4 py-3 font-medium">Support</th>{PLANS.map((p) => <td key={p.id} className="px-4 py-3 text-muted">{p.support}</td>)}</tr>
                <tr><th scope="row" className="sticky left-0 bg-surface px-4 py-3 font-medium">Bring your own OpenAI key</th>{PLANS.map((p) => <td key={p.id} className="px-4 py-3"><Check size={16} className="text-ok" aria-label="Included" /></td>)}</tr>
                <tr><th scope="row" className="sticky left-0 bg-surface px-4 py-3 font-medium">Admin console and reporting</th>{PLANS.map((p) => <td key={p.id} className="px-4 py-3">{p.id === "fleet" ? <Check size={16} className="text-ok" aria-label="Included" /> : <Minus size={16} className="text-subtle" aria-label="Not included" />}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="mx-auto mt-10 max-w-3xl rounded-xl border border-line bg-surface p-6">
        <h3 className="text-base font-semibold tracking-tight">How interview credits work</h3>
        <p className="mt-1 text-sm text-muted">Every plan comes with a monthly pool of credits. A mock interview takes credits from it when it starts, and a failed start gives them back. Unused credits do not roll over.</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {[["Text interview", INTERVIEW_COSTS.text, "Type your answers. No microphone needed."], ["Voice interview", INTERVIEW_COSTS.voice, "Talk it through with a spoken AI interviewer."], ["Coding interview", INTERVIEW_COSTS.coding, "A live editor with test runs and a code review."]].map(([t, c, d]) => (
            <div key={t as string} className="rounded-lg border border-line p-4"><dt className="text-sm font-semibold">{t}</dt><dd className="mt-1 text-2xl font-bold tracking-tight">{credits(c as number)}</dd><dd className="mt-1 text-xs text-muted">{d}</dd></div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-subtle">Using your own OpenAI key in Settings means interviews do not use credits.</p>
      </div>
    </section>
  );
}
