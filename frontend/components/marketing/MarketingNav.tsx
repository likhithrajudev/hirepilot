"use client";

import Brand from "@/components/Brand";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function MarketingNav() {
  const { status } = useAuth();
  return (
    <header className="workspace-rail sticky top-0 z-40 border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <Brand responsive />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          <Link href="/#features" className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg">Product</Link>
          <Link href="/careers" className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg">Careers</Link>
          <Link href="/pricing" className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg">Pricing</Link>
          <Link href="/#faq" className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg">FAQ</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {status === "authed" ? (
            <Link href="/home" className="btn btn-primary">Open app</Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost">Sign in</Link>
              <Link href="/signup" className="btn btn-primary">Get started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
