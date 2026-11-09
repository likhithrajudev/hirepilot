"use client";

import { Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { AppleIcon, GitHubIcon, GoogleIcon } from "./icons";

export function safeNext(n: string | null): string {
  return n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") && !/[\r\n]/.test(n) ? n : "/home";
}

export function useProviders() {
  const [p, setP] = useState<{ google: boolean; github: boolean; apple: boolean; signup_open: boolean } | null>(null);
  useEffect(() => { fetch("/api/auth/providers").then((r) => r.json()).then(setP).catch(() => setP({ google: false, github: false, apple: false, signup_open: true })); }, []);
  return p;
}

export function OAuthButtons({ next, verb = "Continue" }: { next: string; verb?: string }) {
  const p = useProviders();
  const items = [
    { id: "google", label: "Google", icon: <GoogleIcon />, on: p?.google },
    { id: "github", label: "GitHub", icon: <GitHubIcon />, on: p?.github },
    { id: "apple", label: "Apple", icon: <AppleIcon />, on: p?.apple },
  ] as const;
  return (
    <div className="grid gap-2.5">
      {items.map((it) => (
        <a
          key={it.id}
          href={it.on ? `/api/auth/oauth/${it.id}/start?next=${encodeURIComponent(next)}` : undefined}
          aria-disabled={!it.on} title={it.on ? undefined : `${it.label} sign-in is not configured on this server yet`}
          className={`btn !h-11 w-full !justify-center gap-2.5 text-[14px] ${it.on ? "" : "pointer-events-none opacity-45"}`}
        >
          {it.icon}{verb} with {it.label}
          {p && !it.on && <span className="chip bg-surface2 text-subtle">Not set up</span>}
        </a>
      ))}
    </div>
  );
}

export const Divider = ({ children = "or" }: { children?: React.ReactNode }) => (
  <div className="my-6 flex items-center gap-3 text-xs text-subtle"><span className="h-px flex-1 bg-line" />{children}<span className="h-px flex-1 bg-line" /></div>
);

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="mb-4 flex gap-2.5 rounded-lg border border-bad/25 bg-bad-soft px-3.5 py-3 text-[13px] leading-relaxed text-bad"><TriangleAlert size={15} className="mt-0.5 shrink-0" /><span>{children}</span></div>;
}

export function PasswordField({ id, label, value, onChange, autoComplete, meter = false, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; meter?: boolean; placeholder?: string }) {
  const [show, setShow] = useState(false);
  // Length matters more than symbols; this mirrors the server's rule (10+ characters, not a common password).
  const score = Math.min(4, (value.length >= 10 ? 1 : 0) + (value.length >= 14 ? 1 : 0) + (/[a-z]/.test(value) && /[A-Z0-9\W]/.test(value) ? 1 : 0) + (new Set(value).size >= 8 ? 1 : 0));
  const labels = ["Too short", "Weak", "Okay", "Good", "Strong"];
  const tones = ["var(--line2)", "var(--bad)", "var(--warn)", "var(--ok)", "var(--ok)"];
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <input id={id} className="input !h-11 !pr-11" type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} required />
        <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-subtle hover:text-fg">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      </div>
      {meter && value && (
        <div className="mt-2 flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className="h-1 flex-1 rounded-full transition-colors" style={{ background: i < score ? tones[score] : "var(--line)" }} />)}</div>
          <span className="w-16 text-right text-[11px] text-subtle">{labels[score]}</span>
        </div>
      )}
    </div>
  );
}

export function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return <button type="submit" disabled={busy} className="btn btn-primary !h-11 w-full text-[14px]">{busy && <Loader2 size={15} className="animate-spin" />}{children}</button>;
}
