"use client";

const PALETTE = ["bg-[#8A75FF] text-[#0A0A0A]", "bg-[#FF8AE6] text-[#0A0A0A]", "bg-[#FF8A3D] text-[#0A0A0A]", "bg-[#3DDC84] text-[#0A0A0A]", "bg-surface2 text-fg"];
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
export function Avatar({ name, i = 0, size = 34 }: { name: string; i?: number; size?: number }) {
  return <span aria-hidden="true" style={{ width: size, height: size }} className={`grid shrink-0 place-items-center rounded-[9px] text-[12px] font-bold ${PALETTE[i % PALETTE.length]}`}>{initials(name)}</span>;
}

export const scoreTone = (n: number) => (n >= 80 ? "bg-ok-soft text-ok" : n >= 65 ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad");

export function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return <div className="rounded-xl border border-line bg-surface p-4"><p className="eyebrow">{label}</p><p className="mt-1.5 text-[26px] font-bold leading-none tracking-tight">{value}{note && <span className="ml-2 text-[13px] font-medium text-muted">{note}</span>}</p></div>;
}

export function SegControl<T extends string>({ items, value, onChange, label }: { items: readonly T[]; value: T; onChange: (v: T) => void; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{items.map((it) => <button key={it} type="button" aria-pressed={value === it} onClick={() => onChange(it)}>{it}</button>)}</div>;
}
