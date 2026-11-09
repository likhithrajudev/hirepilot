"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { safeNext } from "@/components/auth/parts";
import { useAuth } from "@/lib/auth";

function Redirector({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  useEffect(() => { if (status === "authed") router.replace(next); }, [status, router, next]); // already signed in: skip the form
  return <>{children}</>;
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}><Redirector>{children}</Redirector></Suspense>;
}
