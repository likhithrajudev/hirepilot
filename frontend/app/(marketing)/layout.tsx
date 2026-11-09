import Brand from "@/components/Brand";
import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:shadow-pop">Skip to content</a>
      <MarketingNav />
      <main id="main" className="marketing min-h-[60vh]">{children}</main>
      <footer className="workspace-rail border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted">
          <Link href="/" className="flex items-center gap-2 font-semibold text-fg"><Brand /></Link>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2"><Link href="/careers">Careers</Link><Link href="/pricing" className="hover:text-fg">Pricing</Link><Link href="/login" className="hover:text-fg">Sign in</Link><Link href="/signup" className="hover:text-fg">Create account</Link></nav>
          <p className="w-full text-xs text-subtle sm:w-auto">© 2026 HirePilot</p>
        </div>
      </footer>
    </>
  );
}
