"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AuthShell from "@/components/auth/AuthShell";
import { Divider, ErrorBanner, OAuthButtons, PasswordField, Submit, safeNext } from "@/components/auth/parts";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function LoginForm() {
  const sp = useSearchParams();
  const next = safeNext(sp.get("next"));
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(sp.get("error") ?? "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password); // on success the (auth) layout redirects to `next`
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.status === 429 ? `Too many attempts. Try again in ${Math.max(1, Math.ceil((e2.retryAfter || 60) / 60))} minute(s).` : e2.message);
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue to your resumes and roles.">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <OAuthButtons next={next} />
      <Divider>or sign in with email</Divider>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" autoComplete="email" className="input !h-11" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
        </div>
        <div>
          <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          <div className="mt-2 text-right"><Link href="/forgot" className="text-xs font-medium text-brand hover:underline">Forgot your password?</Link></div>
        </div>
        <Submit busy={busy}>Sign in</Submit>
      </form>
      <p className="mt-6 text-center text-sm text-muted">New to HirePilot? <Link href={`/signup${next !== "/home" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-brand hover:underline">Create an account</Link></p>
    </AuthShell>
  );
}

export default function Page() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
