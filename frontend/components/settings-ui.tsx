"use client";

import { useEffect, useRef, useState } from "react";

export function Row({ title, hint, children, stack = false }: { title: string; hint?: React.ReactNode; children: React.ReactNode; stack?: boolean }) {
  return (
    <div className={`flex gap-4 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0 ${stack ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between"}`}>
      <div className="min-w-0 sm:max-w-[55%]">
        <div className="text-[13.5px] font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</div>}
      </div>
      <div className={stack ? "" : "shrink-0"}>{children}</div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${checked ? "bg-brand" : "bg-line2"} focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]`}
    >
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>)}
    </div>
  );
}

/** Range input that updates its label live and commits (saves) shortly after you stop dragging. */
export function Slider({ value, min, max, step = 1, onCommit, format, label }: { value: number; min: number; max: number; step?: number; onCommit: (v: number) => void; format?: (v: number) => string; label: string }) {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setV(value), [value]);
  return (
    <div className="flex w-56 items-center gap-3">
      <input
        type="range" aria-label={label} min={min} max={max} step={step} value={v} className="h-1.5 flex-1 cursor-pointer accent-[var(--brand)]"
        onChange={(e) => { const n = Number(e.target.value); setV(n); clearTimeout(t.current); t.current = setTimeout(() => onCommit(n), 350); }}
      />
      <span className="w-12 text-right text-xs tabular-nums text-muted">{format ? format(v) : v}</span>
    </div>
  );
}

/** Text field that saves on pause/blur instead of on every keystroke. */
export function TextField({ value, onCommit, multiline = false, placeholder, rows = 3, maxLength, label }: { value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string; rows?: number; maxLength?: number; label: string }) {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setV(value), [value]);
  const commit = (x: string) => { clearTimeout(t.current); if (x !== value) onCommit(x); };
  const common = { value: v, placeholder, maxLength, "aria-label": label, className: "input", onBlur: () => commit(v),
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => { setV(e.target.value); clearTimeout(t.current); t.current = setTimeout(() => commit(e.target.value), 700); } };
  return multiline ? <textarea rows={rows} {...common} className="input resize-y" /> : <input {...common} />;
}

export function SectionCard({ title, description, children, actions }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div><h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>{description && <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">{description}</p>}</div>
        {actions}
      </div>
      {children}
    </section>
  );
}
