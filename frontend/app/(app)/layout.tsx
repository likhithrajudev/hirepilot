"use client";

import Brand from "@/components/Brand";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import Nav from "@/components/Nav";
import Sidebar from "@/components/Sidebar";
import { Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/** Shown while we find out who you are. It has the real shell's proportions, so nothing jumps when the app appears. */
function Splash() {
  return (
    <div aria-busy="true" aria-label="Loading HirePilot">
      <div className="flex h-14 items-center gap-3 border-b border-line bg-surface px-5">
        <Brand compact />
        <Skeleton className="hidden h-4 w-24 sm:block" />
        <div className="ml-auto flex items-center gap-2"><Skeleton className="hidden h-9 w-64 md:block" /><Skeleton className="h-8 w-8 rounded-full" /></div>
      </div>
      <div className="flex">
        <div className="hidden h-[calc(100vh-3.5rem)] w-[244px] shrink-0 space-y-2 border-r border-line workspace-rail p-3 md:block">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}
        </div>
        <div className="min-w-0 flex-1 space-y-4 px-5 py-8"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-96 max-w-full" /><Skeleton className="h-40" /></div>
      </div>
    </div>
  );
}

/** Moves keyboard and screen-reader focus to the page content after a route change, as a full page load would. */
function RouteFocus({ main }: { main: React.RefObject<HTMLElement | null> }) {
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } main.current?.focus({ preventScroll: true }); }, [path, main]);
  return null;
}

function Gate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const qs = useSearchParams().toString();
  useEffect(() => {
    if (status === "anon") router.replace(`/login?next=${encodeURIComponent(path + (qs ? `?${qs}` : ""))}`);
  }, [status, router, path, qs]);
  const main = useRef<HTMLElement | null>(null);
  if (status !== "authed") return <Splash />; // nothing from the app renders, or requests, until we know who you are
  return (
    <>
      <a href="#main" className="sr-only z-[200] rounded-md bg-surface px-3 py-2 text-sm font-semibold text-fg shadow-pop focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <Nav />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main id="main" ref={main} tabIndex={-1} className="min-w-0 flex-1 outline-none">{children}</main>
      </div>
      <RouteFocus main={main} />
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<Splash />}><Gate>{children}</Gate></Suspense>;
}
