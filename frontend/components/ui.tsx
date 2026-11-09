"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { cloneElement, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useCompanyIndex } from "@/lib/hooks";

/** Deterministic colour per company so each gets a stable, recognisable avatar. */
const HUES = [248, 200, 160, 28, 330, 280, 12, 180, 100, 220];
export function CompanyAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const h = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  return (
    <div
      aria-hidden
      className="grid shrink-0 place-items-center rounded-lg font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `hsl(${h} 30% 35%)`,
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.25)",
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </div>
  );
}

/** Real company logo (from its domain), with the colored initial as an instant placeholder and fallback. */
export function CompanyLogo({ name, size = 44 }: { name: string; size?: number }) {
  const { data } = useCompanyIndex();
  const co = useMemo(() => data?.find((c) => c.name === name), [data, name]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = co?.domain && co.logo && !failed ? `https://www.google.com/s2/favicons?domain=${co.domain}&sz=128` : null;
  return (
    <div className="relative shrink-0 overflow-hidden rounded-xl bg-surface ring-1 ring-line" style={{ width: size, height: size }}>
      {!loaded && <CompanyAvatar name={name} size={size} />}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src} alt={`${name} logo`} width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full bg-white object-contain p-[18%] transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

/** Number that eases up to its value when it scrolls into view. */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!inView || !ref.current) return;
    const el = ref.current;
    if (reduceMotion || document.documentElement.dataset.motion === "reduce") { el.textContent = String(value); return; }
    const c = animate(0, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => (el.textContent = String(Math.round(v))) });
    return () => c.stop();
  }, [inView, value, reduceMotion]);
  return <span ref={ref} className="tabular-nums">0</span>;
}

/** Circular match gauge. */
export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = score ?? 0;
  const color = score === null ? "var(--line2)" : score >= 75 ? "var(--ok)" : score >= 50 ? "var(--warn)" : "var(--subtle)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={score === null ? "Not scored yet" : `${score}% match`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={3.5} />
        {score !== null && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .6s ease" }}
          />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums" style={{ color: score === null ? "var(--subtle)" : "var(--fg)" }}>
        {score === null ? "–" : score}
      </span>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow = "Your career workspace" }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="page-header flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow mb-2.5">{eyebrow}</p>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-1px] sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line2 bg-surface px-6 py-14 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2 text-[13px] text-bad">{children}</p>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function timeAgo(iso: string): string {
  const utc = /Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z"; // server timestamps are UTC
  const sec = (Date.now() - new Date(utc).getTime()) / 1000;
  const units: [number, string][] = [[31557600, "y"], [2629800, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]];
  for (const [n, label] of units) if (sec >= n) return `${Math.floor(sec / n)}${label} ago`;
  return "just now";
}


/* ───────── Badge: one component for every status pill, so tones and contrast stay consistent ───────── */
const TONES = {
  neutral: "bg-surface2 text-muted", brand: "bg-brand-soft text-brand", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad",
} as const;
export type Tone = keyof typeof TONES;
export function Badge({ tone = "neutral", icon, children, className = "" }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return <span className={`chip ${TONES[tone]} ${className}`}>{icon}{children}</span>;
}

/* ───────── Field: a label tied to its control, with optional hint and error ─────────
   Clones `id`, `aria-describedby` and `aria-invalid` onto the single child so labels are never decorative. */
export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: ReactNode; error?: string; children: ReactElement<Record<string, unknown>>; className?: string }) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className={`space-y-1 ${className}`}>
      <label htmlFor={id} className="label !mb-0">{label}</label>
      {cloneElement(children, { id, "aria-describedby": note ? `${id}-note` : undefined, "aria-invalid": error ? true : undefined })}
      {note && <p id={`${id}-note`} className={`text-xs ${error ? "text-bad" : "text-muted"}`} role={error ? "alert" : undefined}>{note}</p>}
    </div>
  );
}

/* ───────── Tabs: WAI-ARIA tablist with arrow-key navigation. Pair the panel with role="tabpanel" aria-labelledby={`${idPrefix}-tab-${value}`} ───────── */
export interface TabItem<T extends string> { id: T; label: string; icon?: ReactNode }
export function Tabs<T extends string>({ items, value, onChange, idPrefix, label, className = "" }: { items: readonly TabItem<T>[]; value: T; onChange: (v: T) => void; idPrefix: string; label: string; className?: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? (i + 1) % items.length : e.key === "ArrowLeft" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    onChange(items[n].id);
    refs.current[items[n].id]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 ${className}`}>
      {items.map((t, i) => (
        <button
          key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`${idPrefix}-tab-${t.id}`} aria-selected={value === t.id} aria-controls={`${idPrefix}-panel`}
          tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)} onKeyDown={(e) => move(e, i)}
          className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${value === t.id ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface2 hover:text-fg"}`}
        >
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}
