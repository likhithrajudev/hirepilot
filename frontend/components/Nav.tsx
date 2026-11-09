"use client";

import { ChevronRight, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { useSidebar } from "@/components/Sidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Brand from "@/components/Brand";
import { useTheme } from "@/app/providers";
import AccountMenu from "@/components/AccountMenu";
import ActivityTray from "@/components/ActivityTray";
import { useSettings } from "@/lib/hooks";

const openPalette = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));

export default function Nav() {
  const { data } = useSettings();
  const path = usePathname();
  const section = ({ home: "Overview", jobs: "Find opportunities", resumes: "Resume studio", companies: "Company directory", interviews: "Interview practice", settings: "Settings", admin: "Admin portal", applications: "My applications" } as Record<string, string>)[path.split("/")[1]] ?? "Workspace";
  const { theme, toggle } = useTheme();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const needsKey = data && !data.openai_configured;

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:gap-5 sm:px-6 workspace-rail">
      <button className="btn btn-ghost btn-icon -ml-1 md:hidden!" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><PanelLeft size={18} /></button>
      <Link href="/home" className="group flex items-center gap-2.5 font-semibold tracking-tight">
        <Brand responsive />
      </Link>

      <span className="hidden h-5 w-px bg-line lg:block" /><span className="hidden items-center gap-2 text-xs text-muted lg:flex">Workspace <ChevronRight size={12} /><span className="font-medium text-fg">{section}</span></span>
      <div className="ml-auto flex items-center gap-2">
        {needsKey && (
          <Link href="/settings" className="chip hidden bg-warn-soft sm:inline-flex !px-3 !py-1.5 text-warn transition hover:brightness-95">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
            <span className="hidden sm:inline">Connect AI</span>
            <span className="sm:hidden">Add key</span>
          </Link>
        )}
        <button className="btn btn-ghost btn-icon md:hidden!" aria-label="Search and commands" onClick={openPalette}><Search size={16} /></button>
        <button className="hidden h-9 w-52 cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg px-3 text-left text-[13px] text-muted transition hover:border-subtle hover:bg-surface2 md:flex" aria-label="Search and commands" onClick={openPalette}>
          <Search size={14} className="shrink-0" /><span className="flex-1 truncate">Search or jump to…</span><span className="kbd">⌘K</span>
        </button>
        <ActivityTray />
        <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <AccountMenu />
      </div>
    </header>
  );
}
