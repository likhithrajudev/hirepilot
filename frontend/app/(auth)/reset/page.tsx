"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AuthShell from "@/components/auth/AuthShell";
import { ErrorBanner, PasswordField, Submit } from "@/components/auth/parts";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(token ? "" : "This reset link is incomplete. Request a new one.");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth/password/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    if (r.status === 204) setDone(true);
    else { try { const d = await r.json(); setError(typeof d.detail === "string" ? d.detail : "Could not reset your password."); } catch { setError("Could not reset your password."); } }
    setBusy(false);
  };
  return (
    <AuthShell title="Choose a new password" subtitle="You will be signed out everywhere else once this is saved.">
      {done ? (
        <div className="rounded-xl border border-ok/25 bg-ok-soft p-5 text-sm">
          <CheckCircle2 className="mb-2 text-ok" size={20} /><p className="font-medium text-ok">Password updated</p>
          <Link href="/login" className="btn btn-primary mt-4 !h-11 w-full">Sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <PasswordField id="password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" meter placeholder="At least 10 characters" />
          <Submit busy={busy}>Save new password</Submit>
        </form>
      )}
    </AuthShell>
  );
}

export default function Page() {
  return <Suspense fallback={null}><ResetForm /></Suspense>;
}
