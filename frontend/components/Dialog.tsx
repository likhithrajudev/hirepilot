"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "./overlay";

/* ───────── Modal primitive ───────── */
export function Modal({
  open, onClose, title, description, icon, children, footer, size = "md", dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissable?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useOverlay({ open, onClose, panel, dismissable });

  const width = { sm: "max-w-[400px]", md: "max-w-[480px]", lg: "max-w-[640px]", xl: "max-w-[860px]" }[size];
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] grid place-items-center p-4">
          <motion.div
            className="absolute inset-0 bg-[rgb(10_12_24/0.5)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            onClick={dismissable ? onClose : undefined}
          />
          <motion.div
            ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
            className={`relative flex max-h-[min(88vh,820px)] w-full ${width} flex-col overflow-hidden rounded-xl border border-line2 bg-surface shadow-[var(--shadow-lg)]`}
            initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
          >
            <div className="flex items-start gap-3.5 px-6 pb-3 pt-6">
              {icon && <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</div>}
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-[17px] font-semibold leading-snug tracking-tight">{title}</h2>
                {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
              </div>
              {dismissable && (
                <button aria-label="Close" onClick={onClose} className="btn btn-ghost btn-icon -mr-2 -mt-1 text-subtle"><X size={16} /></button>
              )}
            </div>
            {children && <div data-lenis-prevent className="min-h-0 flex-1 overflow-auto px-6 pb-2">{children}</div>}
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface2/50 px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ───────── Promise-based confirm / prompt ───────── */
interface ConfirmOpts { title: string; body?: React.ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
interface PromptOpts { title: string; body?: React.ReactNode; label?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string }
type State =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

const Ctx = createContext<{ confirm: (o: ConfirmOpts) => Promise<boolean>; prompt: (o: PromptOpts) => Promise<string | null> } | null>(null);

export function useDialog() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDialog must be used inside <DialogProvider>");
  return c;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => { setState({ kind: "confirm", opts, resolve }); setOpen(true); }), []);
  const prompt = useCallback((opts: PromptOpts) => new Promise<string | null>((resolve) => { setText(opts.defaultValue ?? ""); setState({ kind: "prompt", opts, resolve }); setOpen(true); }), []);

  const settle = (v: boolean | string | null) => {
    if (!state) return;
    setOpen(false);
    (state.resolve as (x: unknown) => void)(state.kind === "confirm" ? v === true : typeof v === "string" ? v : null);
  };
  const cancel = useCallback(() => settle(state?.kind === "confirm" ? false : null), [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      <Modal
        open={open && !!state}
        onClose={cancel}
        size="sm"
        title={state?.opts.title ?? ""}
        description={state?.opts.body}
        icon={state?.kind === "confirm" && state.opts.danger ? <AlertTriangle size={18} className="text-bad" /> : undefined}
        footer={
          state && (
            <>
              <button className="btn" onClick={cancel}>{state.kind === "confirm" ? state.opts.cancelLabel ?? "Cancel" : "Cancel"}</button>
              <button
                data-autofocus={state.kind === "confirm" ? "" : undefined}
                className={`btn ${state.kind === "confirm" && state.opts.danger ? "!border-transparent !bg-bad !text-white hover:brightness-110" : "btn-primary"}`}
                disabled={state.kind === "prompt" && !text.trim()}
                onClick={() => settle(state.kind === "confirm" ? true : text.trim())}
              >
                {state.opts.confirmLabel ?? (state.kind === "confirm" ? "Confirm" : "Save")}
              </button>
            </>
          )
        }
      >
        {state?.kind === "prompt" && (
          <form className="pb-2 pt-1" onSubmit={(e) => { e.preventDefault(); text.trim() && settle(text.trim()); }}>
            {state.opts.label && <label className="label">{state.opts.label}</label>}
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={state.opts.placeholder} data-autofocus />
          </form>
        )}
      </Modal>
    </Ctx.Provider>
  );
}
