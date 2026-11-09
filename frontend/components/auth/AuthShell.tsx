import { ArrowUpRight, Brain, ScanSearch, Sparkles } from "lucide-react";
import Link from "next/link";
import Brand from "@/components/Brand";

const POINTS = [
  { icon: Brain, title: "Reviewed like a hiring manager", body: "Every role is judged on evidence, scope and risk, with the reasoning shown." },
  { icon: ScanSearch, title: "See what the ATS sees", body: "Your real PDF is parsed the way a screening system reads it." },
  { icon: Sparkles, title: "Tailoring that never breaks your LaTeX", body: "The AI edits only the body. Your layout is untouched and every result is checked." },
];

export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="workspace-rail relative hidden overflow-hidden lg:block">
        <div aria-hidden className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "linear-gradient(rgb(255 255 255 / .5) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .5) 1px, transparent 1px)", backgroundSize: "44px 44px", maskImage: "linear-gradient(to bottom, #000, transparent 85%)" }} />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Link href="/" className="flex items-center gap-3 text-lg font-semibold tracking-tight">
            <Brand />
          </Link>
          <div>
            <p className="eyebrow mb-5 text-brand!">Prepare with purpose</p>
            <h2 className="max-w-md text-[40px] font-semibold leading-[1.1] tracking-tight">
              Your potential deserves<br />a great next chapter.
            </h2>
            <ul className="mt-10 max-w-md space-y-6">
              {POINTS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white/10 ring-1 ring-white/15"><Icon size={17} /></span>
                  <div><div className="text-[15px] font-medium">{title}</div><p className="mt-1 text-sm leading-relaxed text-white/70">{body}</p></div>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-white/50">You apply, we prepare. HirePilot never submits anything on your behalf.</p>
        </div>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">
          <Link href="/" className="mb-8 flex items-center gap-2.5 font-semibold tracking-tight lg:hidden">
            <Brand />
          </Link>
          <p className="eyebrow mb-3">Your career, moving forward <ArrowUpRight size={12} className="inline" /></p>
          <h1 className="text-[30px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
