"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import AuthShell from "@/components/auth/AuthShell";
import { ErrorBanner, Submit } from "@/components/auth/parts";

export default function Page() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/password/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (!r.ok && r.status !== 202) throw new Error("Something went wrong. Please try again.");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we will send you a link to choose a new one.">
      {done ? (
        <div className="rounded-xl border border-ok/25 bg-ok-soft p-5 text-sm leading-relaxed">
          <MailCheck className="mb-2 text-ok" size={20} />
          <p className="font-medium text-ok">Check your inbox</p>
          <p className="mt-1 text-muted">If that address has an account, a reset link is on its way. It works for one hour.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" type="email" autoComplete="email" className="input !h-11" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
          </div>
          <Submit busy={busy}>Send reset link</Submit>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted"><Link href="/login" className="font-medium text-brand hover:underline">Back to sign in</Link></p>
    </AuthShell>
  );
}
