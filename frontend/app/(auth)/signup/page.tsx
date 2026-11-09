"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AuthShell from "@/components/auth/AuthShell";
import { Divider, ErrorBanner, OAuthButtons, PasswordField, Submit, safeNext, useProviders } from "@/components/auth/parts";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function SignupForm() {
  const next = safeNext(useSearchParams().get("next"));
  const { signup } = useAuth();
  const providers = useProviders();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signup(email, password, name);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  if (providers && !providers.signup_open) {
    return <AuthShell title="Sign-ups are closed" subtitle="This workspace is invitation only."><Link href="/login" className="btn btn-primary !h-11 w-full">Back to sign in</Link></AuthShell>;
  }
  return (
    <AuthShell title="Create your account" subtitle="Free to start. No credit card.">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <OAuthButtons next={next} verb="Sign up" />
      <Divider>or use your email</Divider>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="name" className="label">Full name</label>
          <input id="name" className="input !h-11" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
        </div>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" autoComplete="email" className="input !h-11" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </div>
        <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" meter placeholder="At least 10 characters" />
        <Submit busy={busy}>Create account</Submit>
      </form>
      <p className="mt-5 text-center text-xs leading-relaxed text-subtle">By creating an account you agree to our Terms and Privacy Policy.</p>
      <p className="mt-4 text-center text-sm text-muted">Already have an account? <Link href={`/login${next !== "/home" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-brand hover:underline">Sign in</Link></p>
    </AuthShell>
  );
}

export default function Page() {
  return <Suspense fallback={null}><SignupForm /></Suspense>;
}
