"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import UpgradeDialog from "@/components/billing/UpgradeDialog";
import { DialogProvider } from "@/components/Dialog";
import { CommandPalette } from "@/components/CommandPalette";
import { SidebarProvider } from "@/components/Sidebar";
import SmoothScroll from "@/components/SmoothScroll";
import { useTasks } from "@/lib/hooks";
import { ApiError, type Paywall, setOnPaywall } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PrefsApplier, usePrefs } from "@/lib/prefs";

/* ───── theme (backed by saved preferences) ───── */
type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

/* ───── toasts ───── */
type Kind = "success" | "error" | "info";
interface Action { label: string; href: string }
interface Toast { id: number; kind: Kind; msg: string; action?: Action }
const ToastCtx = createContext<(msg: string, kind?: Kind, action?: Action) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  const icon = { success: CheckCircle2, error: TriangleAlert, info: Info };
  const tone = { success: "text-ok", error: "text-bad", info: "text-brand" };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = icon[t.kind];
          return (
            <motion.div
              key={t.id} role="status" layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line2 bg-surface p-3 text-[13px] shadow-pop"
            >
              <Icon size={16} className={`mt-0.5 shrink-0 ${tone[t.kind]}`} />
              <span className="min-w-0 flex-1 break-words">{t.msg}</span>
              {t.action && (
                <Link href={t.action.href} onClick={() => dismiss(t.id)} className="btn btn-sm btn-primary -my-0.5 shrink-0">{t.action.label}</Link>
              )}
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="mt-0.5 text-subtle hover:text-fg"><X size={14} /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Tells you when background AI work finishes, wherever you are in the app. Server state is the source of truth. */
function TaskWatcher({ toast }: { toast: (m: string, k?: Kind, a?: Action) => void }) {
  const { data } = useTasks({ limit: 12 });
  const prev = useRef<Map<string, string> | null>(null);
  const started = useRef(Date.now());
  useEffect(() => {
    if (!data) return;
    if (prev.current) {
      for (const t of data) {
        const before = prev.current.get(t.id);
        const wasActive = before === "queued" || before === "running";
        const finishedWhileWatching = before === undefined && t.finished_at && new Date(t.finished_at.endsWith("Z") ? t.finished_at : t.finished_at + "Z").getTime() > started.current;
        if (!(wasActive && t.status !== before) && !finishedWhileWatching) continue;
        const what = t.kind === "tailor" ? "Tailoring" : "ATS check";
        const who = t.label ? ` for ${t.label}` : "";
        if (t.status === "done") {
          toast(`${what}${who} is ready`, "success", { label: t.kind === "tailor" ? "Review" : "View", href: t.kind === "tailor" ? `/resumes/${t.resume_id}?review=${t.id}` : `/resumes/${t.resume_id}?tab=ats` });
        } else if (t.status === "error") {
          toast(`${what}${who} failed: ${t.error ?? "unknown error"}`, "error", { label: "Open", href: `/resumes/${t.resume_id}` });
        }
      }
    }
    prev.current = new Map(data.map((t) => [t.id, t.status]));
  }, [data, toast]);
  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { prefs, update } = usePrefs();
  const { status } = useAuth();
  const authed = status === "authed";
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(document.documentElement.classList.contains("dark"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  const toggle = useCallback(() => update({ theme: document.documentElement.classList.contains("dark") ? "light" : "dark" }), [update]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  // When a limit is hit the upgrade dialog explains it, so the same message must not also appear as an error toast.
  const [paywall, setPaywall] = useState<Paywall | null>(null);
  const paywallMsg = useRef("");
  useEffect(() => { setOnPaywall((p) => { paywallMsg.current = p.message; setPaywall(p); }); return () => setOnPaywall(null); }, []);
  const push = useCallback((msg: string, kind: Kind = "success", action?: Action) => {
    if (kind === "error" && msg === paywallMsg.current) return;
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, msg, action }]);
    setTimeout(() => dismiss(id), action ? 9000 : kind === "error" ? 7000 : 3500);
  }, [dismiss]);

  return (
    <MotionConfig reducedMotion={prefs.reduce_motion ? "always" : "user"}>
      <ThemeCtx.Provider value={{ theme: dark ? "dark" : "light", toggle }}>
        <ToastCtx.Provider value={push}>
          <DialogProvider>
            {authed && <PrefsApplier />}
            <SmoothScroll enabled={prefs.smooth_scroll && !prefs.reduce_motion} />
            {authed && <TaskWatcher toast={push} />}
            {authed && <CommandPalette />}
            <SidebarProvider>{children}</SidebarProvider>
            {authed && <UpgradeDialog paywall={paywall} onClose={() => setPaywall(null)} />}
          </DialogProvider>
          <ToastStack toasts={toasts} dismiss={dismiss} />
        </ToastCtx.Provider>
      </ThemeCtx.Provider>
    </MotionConfig>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            gcTime: 5 * 60_000,
            retry: (count, err) => (err instanceof ApiError && err.status < 500 ? false : count < 2),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Shell>{children}</Shell>
      </AuthProvider>
      {/* Dev-only: tree-shaken out of production builds. */}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
