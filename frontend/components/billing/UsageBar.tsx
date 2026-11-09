import type { UsageRow } from "@/lib/hooks";

/** A meter that stays readable without colour: the numbers are always shown, and the bar only reinforces them. */
export default function UsageBar({ row, compact = false }: { row: UsageRow; compact?: boolean }) {
  const { used, limit, unmetered_by_own_key: own } = row;
  const pct = limit === null || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const tone = own ? "var(--line2)" : pct >= 100 ? "var(--bad)" : pct >= 80 ? "var(--warn)" : "var(--brand)";
  return (
    <div>
      <div className={`flex items-baseline justify-between gap-3 ${compact ? "text-[12px]" : "text-[13px]"}`}>
        <span className="font-medium">{row.label}</span>
        <span className="tabular-nums text-muted">
          {own ? "Your own key: not counted" : limit === null ? `${used.toLocaleString()} used · unlimited` : `${used.toLocaleString()} of ${limit.toLocaleString()}`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-label={`${row.label} usage`} aria-valuemin={0} aria-valuemax={limit ?? undefined} aria-valuenow={used}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: limit === null ? "0%" : `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}
