"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { safeNext } from "@/components/auth/parts";
import { refreshSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Where the provider sends the browser back. The backend already set the refresh cookie; we trade it for an access token. */
function Callback() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { adopt } = useAuth();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    refreshSession().then((s) => {
      if (s) { adopt(s); router.replace(next); }
      else router.replace("/login?error=" + encodeURIComponent("Sign-in did not complete. Please try again."));
    });
  }, [adopt, router, next]);
  return <div className="grid min-h-screen place-items-center text-sm text-muted"><span className="flex items-center gap-2.5"><Loader2 size={16} className="animate-spin text-brand" />Signing you in…</span></div>;
}

export default function Page() {
  return <Suspense fallback={null}><Callback /></Suspense>;
}
