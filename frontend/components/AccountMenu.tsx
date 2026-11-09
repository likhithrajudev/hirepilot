"use client";

import { AnimatePresence, motion } from "motion/react";
import { CreditCard, LogOut, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useMenuKeys, usePopover } from "@/components/popover";
import { useAuth } from "@/lib/auth";

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" className="rounded-full object-cover ring-1 ring-line" style={{ width: size, height: size }} />
  ) : (
    <span className="grid place-items-center rounded-full bg-brand-soft font-semibold text-brand ring-1 ring-line" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials}</span>
  );
}

export default function AccountMenu() {
  const { user, logout } = useAuth();
  const { open, setOpen, root, close } = usePopover();
  const menu = useMenuKeys(open, close);
  if (!user) return null;
  return (
    <div className="relative" ref={root}>
      <button data-popover-trigger onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="Account menu" className="press rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"><Avatar name={user.name || user.email} src={user.avatar_url} /></button>
      <AnimatePresence>
        {open && (
          <motion.div ref={menu} role="menu" aria-label="Account" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.14 }}
            className="absolute right-0 z-50 mt-2 w-[280px] overflow-hidden rounded-lg border border-line2 bg-surface shadow-pop">
            <div className="flex items-center gap-3 border-b border-line p-4">
              <Avatar name={user.name || user.email} src={user.avatar_url} size={40} />
              <div className="min-w-0"><div className="truncate text-sm font-semibold">{user.name || "Your account"}</div><div className="truncate text-xs text-muted">{user.email}</div></div>
            </div>
            <div className="px-4 py-2.5 text-xs text-muted"><span className="font-medium text-fg">{user.tenant?.name}</span><span className="chip ml-2 bg-brand-soft capitalize text-brand">{user.tenant?.plan ?? "free"}</span></div>
            <div className="border-t border-line p-1.5">
              <Link role="menuitem" href="/settings?section=profile" onClick={() => close(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition hover:bg-surface2"><UserRound size={15} className="text-muted" />Profile</Link>
              <Link role="menuitem" href="/settings?section=billing" onClick={() => close(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition hover:bg-surface2"><CreditCard size={15} className="text-muted" />Plan &amp; billing</Link>
              <Link role="menuitem" href="/settings?section=security" onClick={() => close(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition hover:bg-surface2"><ShieldCheck size={15} className="text-muted" />Account &amp; security</Link>
              <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-bad transition hover:bg-bad-soft"><LogOut size={15} />Sign out</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
