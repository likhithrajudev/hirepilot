"use client";

import { ClipboardList, Kanban, Mic } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/teams", label: "Pipeline", icon: Kanban, exact: true },
  { href: "/teams/assessments", label: "Assessments", icon: ClipboardList },
  { href: "/teams/interviewer", label: "AI interviewer", icon: Mic },
];

export default function TeamsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="workspace-page space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="eyebrow">Hirepilot for teams</p></div>
        <nav aria-label="Hiring" className="flex flex-wrap gap-1 border-b border-line">
          {TABS.map((t) => { const on = t.exact ? path === t.href || path.startsWith("/teams/candidates") : path.startsWith(t.href); return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors ${on ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}><t.icon size={15} />{t.label}</Link>); })}
        </nav>
      </div>
      {children}
    </div>
  );
}
