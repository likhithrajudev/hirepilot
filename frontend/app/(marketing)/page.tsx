import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, FileText, Mic, Search } from "lucide-react";
import CompanyStrip from "@/components/marketing/CompanyStrip";
import Faq from "@/components/marketing/Faq";
import PricingSection from "@/components/marketing/PricingSection";
import { AtsMock, DiffMock, ReviewMock } from "@/components/marketing/ProductMocks";
import RedirectIfAuthed from "@/components/marketing/RedirectIfAuthed";
import { ROADMAP, planById } from "@/lib/plans";

export const metadata: Metadata = {
  title: "HirePilot: land the interview, not the rejection email",
  description: "HirePilot scans 250+ company career sites, reviews every role against your resume the way an engineering manager would, and tailors your LaTeX resume without ever breaking it.",
  openGraph: { title: "HirePilot", description: "Role reviews written like a hiring manager's. ATS checks on your real PDF. AI tailoring that never breaks your LaTeX.", type: "website" },
};

function Feature({ id, eyebrow, title, body, points, visual, flip = false }: { id: string; eyebrow: string; title: string; body: string; points: string[]; visual: React.ReactNode; flip?: boolean }) {
  return (
    <section aria-labelledby={`${id}-title`} className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-2 lg:gap-16 lg:py-24">
      <div className={flip ? "lg:order-2" : ""}>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">{eyebrow}</p>
        <h2 id={`${id}-title`} className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h2>
        <p className="mt-4 text-base leading-relaxed text-muted">{body}</p>
        <ul className="mt-6 space-y-3 text-[15px]">{points.map((p) => <li key={p} className="flex gap-3 leading-snug"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />{p}</li>)}</ul>
      </div>
      <div className={flip ? "lg:order-1" : ""}>{visual}</div>
    </section>
  );
}

export default function Landing() {
  const soon = ROADMAP.map((r) => ({ ...r, from: planById(r.plans[0]).name }));
  return (
    <>
      <RedirectIfAuthed />
      <section aria-labelledby="hero-title" className="marketing-hero border-b border-line">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 sm:py-20 lg:grid-cols-[1fr_1.1fr] lg:gap-14 lg:py-24">
          <div>
            <p className="eyebrow inline-flex items-center gap-2 rounded-full border border-line bg-bg px-3 py-2"><span className="h-1.5 w-1.5 rounded-full bg-brand" /> Built for your next chapter</p>
            <h1 id="hero-title" className="mt-7 text-[44px] leading-[1.04] sm:text-[64px]">Great potential.<br />Meet your next<br /><span className="text-brand">opportunity.</span></h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted">A career workspace for early-career engineers. Find the right roles, tell your story with a tailored resume, and walk into interviews prepared.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3"><Link href="/signup" className="btn btn-primary !h-12 !px-6">Build your next chapter <ArrowUpRight size={17} /></Link><Link href="/#features" className="btn btn-ghost !h-12">Explore the workspace <ArrowRight size={15} /></Link></div>
            <p className="mt-4 flex items-center gap-2 text-xs text-subtle"><Check size={13} className="text-brand" /> Free plan included. No credit card needed.</p>
          </div>
          <div className="relative min-w-0">
            <div className="workspace-rail rounded-t-xl px-5 py-4"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-brand">Opportunity radar</span><span className="text-[10px] text-muted">A look inside HirePilot</span></div><p className="mt-3 text-lg font-medium tracking-tight">Less guesswork. More direction.</p></div>
            <ReviewMock />
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-xs text-muted"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-soft text-brand"><FileText size={14} /></span><span>Your experience stays yours. Review every change before you apply.</span></div>
          </div>
        </div>
        <div className="border-t border-line bg-surface"><div className="mx-auto grid max-w-6xl gap-0 divide-y divide-line px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0">{[{ icon: Search, title: "Find your fit", body: "Roles reviewed against your experience" }, { icon: FileText, title: "Tell your story", body: "LaTeX resumes, carefully tailored" }, { icon: Mic, title: "Build your confidence", body: "Practice with a live AI interviewer" }].map(({ icon: Icon, title, body }, i) => <div key={title} className="flex items-center gap-3 px-3 py-6 sm:px-5"><span className="font-mono text-[10px] text-subtle">0{i + 1}</span><Icon size={19} className="shrink-0 text-brand" /><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-muted">{body}</p></div></div>)}</div></div>
      </section>

      <CompanyStrip />

      <div id="features" className="scroll-mt-20">
        <Feature id="review" eyebrow="Role reviews" title="Every role, reviewed the way a hiring manager would."
          body="Not a keyword score. Each role gets a verdict with the reasoning behind it, so you know where to spend your effort."
          points={["Hard requirements such as years of experience are checked against the dates in your resume, not guessed.", "Must-have skills are verified against your resume text, so a confident answer cannot hide a missing skill.", "See what a manager likes, what worries them, and what they would probe in the first screen."]}
          visual={<ReviewMock />} />
        <div className="border-y border-line bg-surface2/40">
          <Feature id="ats" flip eyebrow="ATS check" title="See exactly what the ATS sees."
            body="Your real PDF is compiled and read back the way a screening system parses it, then scored against the job."
            points={["Read the extracted text, in order, to catch scrambled columns before a recruiter does.", "Must-have and nice-to-have skills matched to the posting, with the fixes that matter most.", "Five ATS-safe templates: single column, real text, standard headings."]}
            visual={<AtsMock />} />
        </div>
        <Feature id="tailor" eyebrow="AI tailoring" title="AI that edits your words, never your layout."
          body="Tailoring runs in the background, so you can keep working. Review the changes side by side and accept only what you like."
          points={["Only the body of your resume is edited. Your preamble and formatting come back byte for byte.", "Every result is compiled and checked for invented numbers, new skills and page count before you see it.", "If it cannot produce valid LaTeX, you keep your original. You never receive broken output."]}
          visual={<DiffMock />} />
      </div>

      <section aria-labelledby="how-title" className="border-y border-line bg-surface2/40">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <h2 id="how-title" className="text-center text-3xl font-semibold tracking-tight">From search to submit in three steps</h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {[["Bring your resume", "Paste or upload your LaTeX, or start from an ATS-safe template filled with your details."], ["Find and rank roles", "Pick your cities. We scan the career sites and review each role against your resume."], ["Tailor and apply", "Tailor your resume, generate a cover letter and answers, then open the employer's page and submit."]].map(([t, b], i) => (
              <li key={t} className="flex gap-4"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line2 text-sm font-semibold tabular-nums" aria-hidden>{i + 1}</span><div><h3 className="text-base font-semibold">{t}</h3><p className="mt-1.5 text-sm leading-relaxed text-muted">{b}</p></div></li>
            ))}
          </ol>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-20 lg:py-28"><PricingSection /></div>

      <section aria-labelledby="soon-title" className="mx-auto max-w-6xl px-5 pb-20">
        <div className="rounded-2xl border border-line p-8 sm:p-10">
          <h2 id="soon-title" className="text-xl font-semibold tracking-tight">On the way</h2>
          <p className="mt-2 text-sm text-muted">Not available yet. We would rather tell you than imply it.</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">{soon.map((r) => <li key={r.key} className="flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3 text-sm"><span>{r.label}</span><span className="chip shrink-0 bg-surface2 text-muted">Coming soon</span></li>)}</ul>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 pb-24"><Faq /></div>

      <section aria-labelledby="cta-title" className="workspace-rail border-t border-line">
        <div className="mx-auto max-w-3xl px-5 py-20 text-center">
          <h2 id="cta-title" className="text-3xl font-semibold tracking-tight">Start with the free plan.</h2>
          <p className="mt-3 text-muted">Add a resume, pick your cities, and see your first reviewed roles in minutes.</p>
          <Link href="/signup" className="btn btn-primary !h-12 !px-7 mt-8 text-[15px]">Create your account</Link>
        </div>
      </section>
    </>
  );
}
