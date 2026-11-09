"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Open/close state for a dropdown or disclosure panel: closes on outside click and Escape, and gives focus back to the trigger. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) root.current?.querySelector<HTMLElement>("[data-popover-trigger]")?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open, close]);
  return { open, setOpen, root, close };
}

/** Roving focus for role="menu": arrows, Home and End move between items; Tab leaves and closes. Focuses the first item on open. */
export function useMenuKeys(open: boolean, onClose: (restore?: boolean) => void) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const t = setTimeout(() => items()[0]?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      if (!list.length || !menu.current?.contains(document.activeElement)) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
      else if (e.key === "Tab") onClose(false);
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  return menu;
}
