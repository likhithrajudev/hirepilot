"use client";

import { useEffect, useRef, type RefObject } from "react";

/* One implementation of "something that sits on top of the page": used by every dialog and the command palette.
   - Focus moves in when it opens and returns to whatever opened it when it closes.
   - Tab cycles inside it. Escape closes it.
   - The page behind cannot scroll, and stays locked until the LAST overlay closes (they can stack: a confirm inside a dialog).
   - Only the top-most overlay reacts to the keyboard. */
const stack: symbol[] = [];
let locks = 0;

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function lock() {
  if (locks++ === 0) { document.documentElement.style.overflow = "hidden"; window.dispatchEvent(new Event("hp:scroll-lock")); }
}
function unlock() {
  if (--locks <= 0) { locks = 0; document.documentElement.style.overflow = ""; window.dispatchEvent(new Event("hp:scroll-unlock")); }
}

export function useOverlay(opts: { open: boolean; onClose: () => void; panel: RefObject<HTMLElement | null>; dismissable?: boolean; initialFocus?: string }) {
  const { open, panel, dismissable = true, initialFocus = "[data-autofocus],input,textarea,button" } = opts;
  const close = useRef(opts.onClose);
  close.current = opts.onClose;
  useEffect(() => {
    if (!open) return;
    const id = Symbol("overlay");
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    lock();
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape" && dismissable) { e.stopPropagation(); close.current(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1], active = document.activeElement;
      if (!panel.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>(initialFocus)?.focus(), 40);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      unlock();
      if (opener?.isConnected) opener.focus?.();
    };
  }, [open, dismissable, panel, initialFocus]);
}
