import { Check, CheckCircle2, FileText } from "lucide-react";

/* Static illustrations of real product screens. The numbers and names are examples, and each one says so. */

const Frame = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <figure className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(16_18_40/0.04),0_12px_32px_-12px_rgb(16_18_40/0.14)]">
    <div className="flex items-center gap-1.5 border-b border-line bg-surface2/60 px-4 py-2.5" aria-hidden><span className="h-2.5 w-2.5 rounded-full bg-line2" /><span className="h-2.5 w-2.5 rounded-full bg-line2" /><span className="h-2.5 w-2.5 rounded-full bg-line2" /></div>
    <div className="p-5">{children}</div>
    <figcaption className="border-t border-line px-5 py-2.5 text-[11px] text-subtle">{label}</figcaption>
  </figure>
);

const Bar = ({ label, v, tone }: { label: string; v: number; tone: string }) => (
  <div><div className="mb-1 flex justify-between text-xs"><span className="font-medium">{label}</span><span className="tabular-nums text-muted">{v}</span></div><div className="h-1.5 rounded-full bg-surface2"><div className="h-full rounded-full" style={{ width: `${v}%`, background: tone }} /></div></div>
);

export function ReviewMock() {
  return (
    <Frame label="Example review. Your real reviews cite your own resume.">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-sm font-semibold text-brand" aria-hidden>S</div>
        <div className="min-w-[140px] flex-1"><div className="text-sm font-semibold">Software Engineer, New Grad</div><div className="text-xs text-muted">Example Co. · Bengaluru</div></div>
        <span className="chip bg-brand-soft text-brand">Yes, interview</span>
      </div>
      <p className="mt-4 rounded-lg bg-surface2 px-3 py-2.5 text-[13px] leading-relaxed text-muted"><span className="font-medium text-fg">Hiring manager:</span> Solid Java and REST fundamentals with real p95 numbers. The gap is distributed systems depth, which I would probe in the first screen.</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div className="space-y-2.5"><Bar label="Technical fit" v={78} tone="var(--ok)" /><Bar label="Evidence of impact" v={80} tone="var(--ok)" /><Bar label="Scope and ramp-up" v={72} tone="var(--warn)" /><Bar label="Learning agility" v={85} tone="var(--ok)" /></div>
        <div className="space-y-2 text-xs"><div className="font-semibold uppercase tracking-wider text-subtle">Must-haves, checked against your resume</div>
          <div className="flex flex-wrap gap-1.5">{["Java ✓", "REST APIs ✓", "SQL ✓", "Kafka ✗"].map((t) => <span key={t} className={`chip ${t.endsWith("✗") ? "bg-bad-soft text-bad" : "bg-ok-soft text-ok"}`}>{t}</span>)}</div></div>
      </div>
    </Frame>
  );
}

export function AtsMock() {
  const r = 38, c = 2 * Math.PI * r;
  return (
    <Frame label="Example ATS check on a compiled PDF.">
      <div className="flex items-center gap-5">
        <div className="relative h-24 w-24 shrink-0" role="img" aria-label="ATS score 82 out of 100">
          <svg viewBox="0 0 92 92" className="-rotate-90"><circle cx="46" cy="46" r={r} fill="none" stroke="var(--line)" strokeWidth="7" /><circle cx="46" cy="46" r={r} fill="none" stroke="var(--ok)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * 0.18} /></svg>
          <div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-2xl font-semibold tabular-nums leading-none">82</div><div className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-subtle">ATS score</div></div></div>
        </div>
        <ul className="space-y-1.5 text-[13px]">{["Email and phone are readable", "Standard section headings found", "Single page, single column", "6 of 8 must-have skills present"].map((t) => <li key={t} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />{t}</li>)}</ul>
      </div>
      <div className="mt-5 rounded-lg bg-surface2 p-3.5 font-mono text-[11.5px] leading-relaxed text-muted">
        <div className="mb-1.5 font-sans text-[11px] font-semibold uppercase tracking-wider text-subtle">What the ATS sees</div>
        Alex Morgan<br />Bengaluru, India | +91 98765 43210 | alex@example.com<br /><span className="text-fg">Experience</span><br />Backend Engineer Intern Jun 2025 – Aug 2025<br />• Built REST APIs in Java and Spring Boot…
      </div>
    </Frame>
  );
}

export function DiffMock() {
  return (
    <Frame label="Example tailoring result. The preamble is never sent to the model.">
      <div className="grid gap-3 font-mono text-[11.5px] leading-relaxed sm:grid-cols-2">
        <div className="rounded-lg border border-line p-3"><div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wider text-subtle">Your resume</div>
          <p className="text-muted">\resumeItem&#123;Built REST APIs in Java serving 2M requests per day.&#125;</p><p className="mt-2 text-muted">\resumeItem&#123;Wrote tests for the order service.&#125;</p></div>
        <div className="rounded-lg border border-brand/30 bg-brand-soft/40 p-3"><div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wider text-brand">Tailored</div>
          <p>\resumeItem&#123;<mark className="rounded bg-brand/15 px-0.5 text-fg">Designed and built</mark> REST APIs in Java serving 2M requests per day.&#125;</p><p className="mt-2">\resumeItem&#123;Wrote <mark className="rounded bg-brand/15 px-0.5 text-fg">integration</mark> tests for the order service.&#125;</p></div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-2 text-xs">{["Compiles", "1 page", "Preamble untouched", "No new numbers or skills"].map((t) => <li key={t} className="chip bg-ok-soft text-ok"><Check size={11} aria-hidden />{t}</li>)}</ul>
    </Frame>
  );
}

export const ResumeGlyph = () => <FileText size={18} aria-hidden />;
