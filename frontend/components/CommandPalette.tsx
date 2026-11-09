"use client";

import { AnimatePresence, motion } from "motion/react";
import { Briefcase, Building2, CornerDownLeft, FilePlus2, FileText, LayoutDashboard, Mic, Moon, Palette, Rows3, Search, Settings, Sparkles, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "./overlay";
import { useResumes } from "@/lib/hooks";
import { usePrefs } from "@/lib/prefs";

interface Cmd { id: string; label: string; hint?: string; group: string; icon: React.ReactNode; keys?: string; run: () => void }

/** Subsequence match with a bonus for prefix/word-start hits. Returns -1 for no match. */
function score(q: string, text: string): number {
  if (!q) return 0;
  const t = text.toLowerCase(), s = q.toLowerCase();
  const idx = t.indexOf(s);
  if (idx >= 0) return 100 - idx + (idx === 0 || t[idx - 1] === " " ? 20 : 0);
  let i = 0, pts = 0;
  for (const c of t) if (c === s[i]) { i++; pts += 1; if (i === s.length) return pts; }
  return -1;
}

export function CommandPalette() {
  const router = useRouter();
  const { prefs, update } = usePrefs();
  const resumes = useResumes();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [mounted, setMounted] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setMounted(true), []);

  const close = useCallback(() => { setOpen(false); setQ(""); setSel(0); }, []);
  const go = useCallback((href: string) => () => router.push(href), [router]);

  const commands: Cmd[] = useMemo(() => {
    const base: Cmd[] = [
      { id: "home", label: "Go to Home", group: "Navigate", icon: <LayoutDashboard size={15} />, keys: "G H", run: go("/home") },
      { id: "resumes", label: "Go to Resumes", group: "Navigate", icon: <FileText size={15} />, keys: "G R", run: go("/resumes") },
      { id: "jobs", label: "Go to Jobs", group: "Navigate", icon: <Briefcase size={15} />, keys: "G J", run: go("/jobs") },
      { id: "companies", label: "Go to Companies", group: "Navigate", icon: <Building2 size={15} />, keys: "G C", run: go("/companies") },
      { id: "interviews", label: "Go to Mock interviews", group: "Navigate", icon: <Mic size={15} />, keys: "G I", run: go("/interviews") },
      { id: "settings", label: "Go to Settings", group: "Navigate", icon: <Settings size={15} />, keys: "G S", run: go("/settings") },
      { id: "new", label: "New resume from a template", hint: "Classic, Modern, Compact, Academic, Minimal", group: "Actions", icon: <FilePlus2 size={15} />, keys: "N", run: go("/resumes?new=1") },
      { id: "scan", label: "Find new jobs", hint: "Scan 250+ career sites", group: "Actions", icon: <Zap size={15} />, run: go("/jobs?scan=1") },
      { id: "theme", label: prefs.theme === "dark" ? "Switch to light theme" : "Switch to dark theme", group: "Appearance", icon: <Moon size={15} />, run: () => update({ theme: document.documentElement.classList.contains("dark") ? "light" : "dark" }) },
      { id: "density", label: prefs.density === "compact" ? "Use comfortable density" : "Use compact density", group: "Appearance", icon: <Rows3 size={15} />, run: () => update({ density: prefs.density === "compact" ? "comfortable" : "compact" }) },
      { id: "accent", label: "Change accent colour…", group: "Appearance", icon: <Palette size={15} />, run: go("/settings?section=appearance") },
      { id: "ai", label: "AI settings", hint: "Strictness, creativity, default instructions", group: "Settings", icon: <Sparkles size={15} />, run: go("/settings?section=ai") },
    ];
    const rs: Cmd[] = (resumes.data ?? []).map((r) => ({ id: `r${r.id}`, label: `Open ${r.name}`, hint: `${r.version_count} version${r.version_count === 1 ? "" : "s"}`, group: "Resumes", icon: <FileText size={15} />, run: go(`/resumes/${r.id}`) }));
    return [...base, ...rs];
  }, [go, prefs.theme, prefs.density, resumes.data, update]);

  const results = useMemo(
    () => commands.map((c) => ({ c, s: Math.max(score(q, c.label), score(q, c.group + " " + c.label), c.hint ? score(q, c.hint) - 20 : -1) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s || 0).map((x) => x.c),
    [commands, q],
  );
  useEffect(() => setSel(0), [q]);

  useEffect(() => {
    let gPending = 0;
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? "") || (e.target as HTMLElement)?.isContentEditable || !!(e.target as HTMLElement)?.closest?.(".monaco-editor");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); setOpen(true); return; }
      if (gPending && Date.now() - gPending < 900) {
        const t = ({ h: "/home", r: "/resumes", j: "/jobs", c: "/companies", i: "/interviews", s: "/settings" } as Record<string, string>)[e.key.toLowerCase()];
        gPending = 0;
        if (t) { e.preventDefault(); router.push(t); }
        return;
      }
      if (e.key.toLowerCase() === "g") gPending = Date.now();
      else if (e.key.toLowerCase() === "n") { router.push("/resumes?new=1"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const panel = useRef<HTMLDivElement>(null);
  useOverlay({ open, onClose: close, panel, initialFocus: "input" });

  const run = (c?: Cmd) => { if (!c) return; close(); setTimeout(c.run, 10); };
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(results[sel]); }
  };
  useEffect(() => { document.querySelector(`[data-cmd-index="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  if (!mounted) return null;
  let lastGroup = "";
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[14vh]">
          <motion.div className="absolute inset-0 bg-[rgb(10_12_24/0.5)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={close} />
          <motion.div
            ref={panel} role="dialog" aria-modal="true" aria-label="Command palette"
            className="relative w-full max-w-[600px] overflow-hidden rounded-xl border border-line2 bg-surface shadow-[var(--shadow-lg)]"
            initial={{ opacity: 0, y: -12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 480, damping: 36 }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={16} className="text-subtle" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey} placeholder="Type a command or search resumes…" aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant={results[sel] ? `cmd-opt-${sel}` : undefined} aria-autocomplete="list"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle" />
              <span className="kbd">esc</span>
            </div>
            <div id="cmd-list" role="listbox" aria-label="Commands" data-lenis-prevent className="max-h-[min(52vh,420px)] overflow-auto p-2">
              {results.length === 0 && <p className="px-3 py-10 text-center text-sm text-muted">No matching commands</p>}
              {results.map((c, i) => {
                const header = c.group !== lastGroup ? c.group : null;
                lastGroup = c.group;
                return (
                  <div key={c.id}>
                    {header && !q && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-subtle first:pt-1">{header}</div>}
                    <button
                      id={`cmd-opt-${i}`} role="option" aria-selected={i === sel} tabIndex={-1} data-cmd-index={i} onMouseMove={() => setSel(i)} onClick={() => run(c)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] transition-colors ${i === sel ? "bg-brand-soft text-brand" : "text-fg"}`}
                    >
                      <span className={i === sel ? "text-brand" : "text-muted"}>{c.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{c.label}{c.hint && <span className="ml-2 text-xs text-subtle">{c.hint}</span>}</span>
                      {c.keys && <span className="flex gap-1">{c.keys.split(" ").map((k) => <span key={k} className="kbd">{k}</span>)}</span>}
                      {i === sel && <CornerDownLeft size={13} className="text-brand" />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-line bg-surface2/60 px-4 py-2 text-[11px] text-subtle">
              <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span><span><span className="kbd">↵</span> run</span><span className="ml-auto"><span className="kbd">⌘</span> <span className="kbd">K</span> anywhere</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
