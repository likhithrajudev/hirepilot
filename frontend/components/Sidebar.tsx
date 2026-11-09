"use client";

import { AnimatePresence, motion } from "motion/react";
import { Briefcase, Building2, ChevronsLeft, ChevronsRight, Code2, FileText, LayoutDashboard, Mic, Settings, Shield, Trophy, Users } from "lucide-react";
import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useOverlay } from "@/components/overlay";
import PlanCard from "@/components/billing/PlanCard";
import { useAuth } from "@/lib/auth";
import { useResumes } from "@/lib/hooks";

/* ───────── state ───────── */
interface Ctx {
  collapsed: boolean;           // what the user sees right now
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  holdCollapsed: () => () => void; // pages that need the room (the editor) collapse it while mounted
}
const SidebarCtx = createContext<Ctx>({ collapsed: false, toggle: () => {}, mobileOpen: false, setMobileOpen: () => {}, holdCollapsed: () => () => {} });
export const useSidebar = () => useContext(SidebarCtx);

const KEY = "hp_sidebar";

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPref] = useState(false);        // saved choice
  const [holds, setHolds] = useState(0);          // pages asking for it to stay collapsed
  const [override, setOverride] = useState<boolean | null>(null); // user opened/closed it while a page was holding it
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => { try { setPref(localStorage.getItem(KEY) === "collapsed"); } catch {} }, []);
  useEffect(() => setMobileOpen(false), [pathname]);          // navigating closes the mobile drawer
  useEffect(() => { if (holds === 0) setOverride(null); }, [holds]);

  const collapsed = override ?? (holds > 0 ? true : pref);
  const toggle = useCallback(() => {
    if (holds > 0) return setOverride(!collapsed);
    setPref(!collapsed);
    try { localStorage.setItem(KEY, !collapsed ? "collapsed" : "expanded"); } catch {}
  }, [collapsed, holds]);
  const holdCollapsed = useCallback(() => { setHolds((n) => n + 1); return () => setHolds((n) => Math.max(0, n - 1)); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/input|textarea|select/i.test(t?.tagName ?? "") || t?.isContentEditable || t?.closest?.(".monaco-editor") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "[") { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = useMemo(() => ({ collapsed, toggle, mobileOpen, setMobileOpen, holdCollapsed }), [collapsed, toggle, mobileOpen, holdCollapsed]);
  return <SidebarCtx.Provider value={value}>{children}</SidebarCtx.Provider>;
}

/** Call from a page that needs full width (the editor). Collapses the sidebar while mounted, restores it after. */
export function useCollapseSidebar() {
  const { holdCollapsed } = useSidebar();
  useEffect(() => holdCollapsed(), [holdCollapsed]);
}

/* ───────── view ───────── */
const SECTIONS = [
  { title: "Workspace", items: [
    { href: "/home", label: "Overview", icon: LayoutDashboard },
    { href: "/resumes", label: "Resume studio", icon: FileText },
    { href: "/jobs", label: "Find opportunities", icon: Briefcase },
    { href: "/applications", label: "My applications", icon: FileText },
    { href: "/companies", label: "Company directory", icon: Building2 },
  ] },
  { title: "Prepare", items: [
    { href: "/interviews", label: "Interview practice", icon: Mic },
    { href: "/practice", label: "Coding practice", icon: Code2 },
    { href: "/contests", label: "Contests", icon: Trophy },
  ] },
  { title: "For teams", items: [{ href: "/teams", label: "Hiring", icon: Users }] },
];

function NavItem({ href, label, icon: Icon, active, collapsed }: { href: string; label: string; icon: typeof FileText; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={href} aria-current={active ? "page" : undefined} aria-label={collapsed ? label : undefined}
      className={`group/item relative flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-colors ${active ? "text-brand" : "text-muted hover:bg-surface2 hover:text-fg"}`}
    >
      {active && <motion.span layoutId="side-active" className="absolute inset-0 rounded-lg bg-brand-soft" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
      {active && <motion.span layoutId="side-bar" className="absolute -left-3 top-1.5 h-6 w-[3px] rounded-r bg-brand" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
      <Icon size={17} className="relative shrink-0" />
      <span className={`relative overflow-hidden whitespace-nowrap transition-[opacity,width] duration-200 ${collapsed ? "w-0 opacity-0" : "w-auto opacity-100"}`}>{label}</span>
      {collapsed && (
        <span role="tooltip" className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-line2 bg-surface px-2.5 py-1.5 text-xs font-medium text-fg opacity-0 shadow-pop transition-opacity duration-150 group-hover/item:opacity-100 group-focus-visible/item:opacity-100">{label}</span>
      )}
    </Link>
  );
}

function Rail({ collapsed, onToggle, showToggle = true }: { collapsed: boolean; onToggle: () => void; showToggle?: boolean }) {
  const path = usePathname();
  const resumes = useResumes();
  const { user } = useAuth();
  const isActive = (h: string) => path.startsWith(h);
  const recents = (resumes.data ?? []).slice(0, 4);
  return (
    <div className="flex h-full flex-col">
      {!collapsed && <div className="mx-5 mb-2 mt-6 border-b border-line pb-5"><p className="eyebrow text-subtle!">Your next chapter</p><p className="mt-2 text-sm font-semibold">The career workspace</p><p className="mt-1 text-xs text-muted">Find your fit. Show your best.</p></div>}
      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto overflow-x-visible px-3 pb-3 pt-4" data-lenis-prevent>
        {SECTIONS.map((sec, i) => (
          <div key={sec.title} className={i > 0 ? "pt-5" : ""}>
            {!collapsed ? <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{sec.title}</div> : i > 0 && <div className="mx-3 mb-2 border-t border-line" />}
            <div className="space-y-0.5">{sec.items.map((n) => <NavItem key={n.href} {...n} active={isActive(n.href)} collapsed={collapsed} />)}</div>
          </div>
        ))}
        {!collapsed && recents.length > 0 && (
          <div className="pt-5">
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Recent resumes</div>
            {recents.map((r) => (
              <Link key={r.id} href={`/resumes/${r.id}`} className={`flex h-8 items-center gap-2.5 truncate rounded-lg px-3 text-[12.5px] transition-colors ${path === `/resumes/${r.id}` ? "bg-surface2 font-medium text-fg" : "text-muted hover:bg-surface2 hover:text-fg"}`}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-line2" /><span className="truncate">{r.name}</span>
              </Link>
            ))}
          </div>
        )}
      </nav>
      <div className="space-y-1 border-t border-line px-3 py-3">
        <PlanCard collapsed={collapsed} />
        {user?.is_platform_admin && <NavItem href="/admin" label="Admin portal" icon={Shield} active={isActive("/admin")} collapsed={collapsed} />}
        <NavItem href="/settings" label="Settings" icon={Settings} active={isActive("/settings")} collapsed={collapsed} />
        {showToggle && (
          <button
            onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}
            className="group/item press relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-subtle transition-colors hover:bg-surface2 hover:text-fg"
          >
            {collapsed ? <ChevronsRight size={17} className="shrink-0" /> : <ChevronsLeft size={17} className="shrink-0" />}
            <span className={`overflow-hidden whitespace-nowrap transition-[opacity,width] duration-200 ${collapsed ? "w-0 opacity-0" : "w-auto opacity-100"}`}>Collapse</span>
            {!collapsed && <span className="kbd ml-auto">[</span>}
            {collapsed && <span role="tooltip" className="pointer-events-none absolute left-full z-50 ml-3 flex items-center gap-2 whitespace-nowrap rounded-lg border border-line2 bg-surface px-2.5 py-1.5 text-xs font-medium text-fg opacity-0 shadow-pop transition-opacity group-hover/item:opacity-100">Expand <span className="kbd">[</span></span>}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useSidebar();
  const drawer = useRef<HTMLElement | null>(null);
  useOverlay({ open: mobileOpen, onClose: () => setMobileOpen(false), panel: drawer, initialFocus: "a,button" });
  return (
    <>
      {/* desktop: sticky rail under the top bar */}
      <aside
        aria-label="Sidebar"
        className={`workspace-rail sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-line transition-[width] duration-[220ms] ease-[cubic-bezier(.22,1,.36,1)] md:block ${collapsed ? "w-[64px]" : "w-[244px]"}`}
      >
        <Rail collapsed={collapsed} onToggle={toggle} />
      </aside>

      {/* mobile: drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-x-0 bottom-0 top-14 z-40 md:hidden">
            <motion.div className="absolute inset-0 bg-[rgb(10_12_24/0.45)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside
              ref={drawer} role="dialog" aria-modal="true" aria-label="Navigation" className="workspace-rail absolute inset-y-0 left-0 flex w-[min(280px,90vw)] flex-col border-r border-line shadow-[var(--shadow-lg)]"
              initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: "spring", stiffness: 420, damping: 38 }}
            >
              <button className="btn btn-ghost m-3 mb-0" onClick={() => setMobileOpen(false)}>Close navigation</button>
              <div className="min-h-0 flex-1"><Rail collapsed={false} onToggle={() => setMobileOpen(false)} showToggle={false} /></div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
