import data from "./plans.generated.json";

/** Generated from the backend plan catalog (backend/app/services/plans.py). Never edit the JSON by hand. */
export type PlanId = "cadet" | "pilot" | "captain" | "fleet";
export type MeteredKey = "resumes" | "tailor" | "ats_check" | "review" | "apply_kit" | "scans";
export type Currency = "USD" | "INR";
export type Interval = "month" | "year";

export interface PlanDef {
  id: PlanId;
  name: string;
  tagline: string;
  audience: string;
  prices: Record<Currency, Record<Interval, number | null>>;
  limits: Record<MeteredKey, number | null>;
  templates: string[];
  seats: number | null;
  support: string;
  rank: number;
  contact_sales: boolean;
  recommended: boolean;
  highlights: string[];
}
export interface MeteredDef { key: MeteredKey; label: string; period: "total" | "month"; unit: string }
export interface RoadmapItem { key: string; label: string; plans: PlanId[] }

export const PLANS = data.plans as PlanDef[];
export const METERED = data.metered as MeteredDef[];
export const ROADMAP = data.roadmap as RoadmapItem[];
/** What one mock interview costs, in credits (from the backend plan catalog). */
export const INTERVIEW_COSTS = (data as unknown as { interview_costs: { text: number; voice: number; coding: number } }).interview_costs;
export const credits = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;
export const planById = (id: string): PlanDef => PLANS.find((p) => p.id === id) ?? PLANS[0];
export const CURRENCIES: Currency[] = ["USD", "INR"];

export function money(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}
export const priceOf = (p: PlanDef, c: Currency, i: Interval): number | null => p.prices[c][i];
/** Annual plans cost ten months; this is what the buyer pays per month on that plan. */
export const perMonth = (p: PlanDef, c: Currency, i: Interval): number | null => {
  const v = priceOf(p, c, i);
  return v === null ? null : i === "year" ? Math.round(v / 12) : v;
};
export const limitText = (key: MeteredKey, limit: number | null): string => {
  const m = METERED.find((x) => x.key === key)!;
  if (limit === null) return `Unlimited ${m.unit}`;
  return `${limit.toLocaleString()} ${m.unit}${m.period === "month" ? " / month" : ""}`;
};
/** Guess a sensible default currency from the browser's time zone (display only; the buyer can switch). */
export function guessCurrency(): Currency {
  try { return /Kolkata|Calcutta/.test(Intl.DateTimeFormat().resolvedOptions().timeZone) ? "INR" : "USD"; } catch { return "USD"; }
}
