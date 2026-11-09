"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, AuthUser, Session, refreshSession, setAccessToken, setOnAuthLost } from "./api";

type Status = "loading" | "authed" | "anon";
interface Ctx {
  status: Status;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  adopt: (s: Session) => void;
  reloadUser: () => Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = () => {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
};

async function post(path: string, body?: unknown): Promise<Session> {
  const res = await fetch(`/api/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const d = await res.json(); if (typeof d.detail === "string") msg = d.detail; else if (Array.isArray(d.detail)) msg = d.detail.map((x: { msg: string }) => x.msg).join("; "); } catch {}
    throw new ApiError(msg, res.status, [], "", Number(res.headers.get("Retry-After") ?? 0));
  }
  return (await res.json()) as Session;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const channel = useRef<BroadcastChannel | null>(null);
  const qc = useQueryClient();
  const lastUser = useRef<number | null>(null);

  const schedule = useCallback((expiresIn: number) => {
    clearTimeout(timer.current);
    // Renew a minute before expiry so requests rarely hit a 401 at all.
    timer.current = setTimeout(async () => {
      const s = await refreshSession();
      if (s) { setUser(s.user); schedule(s.expires_in); } else { setUser(null); setStatus("anon"); }
    }, Math.max(15, expiresIn - 60) * 1000);
  }, []);

  const adopt = useCallback((s: Session) => {
    if (lastUser.current !== null && lastUser.current !== s.user.id) qc.clear(); // never show one account's cached data to another
    lastUser.current = s.user.id;
    setAccessToken(s.access_token);
    setUser(s.user);
    setStatus("authed");
    schedule(s.expires_in);
  }, [schedule, qc]);

  // On load: if the refresh cookie is valid we are signed in, with no password prompt and no token in storage.
  useEffect(() => {
    let alive = true;
    refreshSession().then((s) => { if (!alive) return; if (s) adopt(s); else setStatus("anon"); });
    return () => { alive = false; clearTimeout(timer.current); };
  }, [adopt]);

  const lose = useCallback(() => { clearTimeout(timer.current); setAccessToken(null); setUser(null); setStatus("anon"); lastUser.current = null; qc.clear(); }, [qc]);
  useEffect(() => {
    setOnAuthLost(lose);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("hp-auth");
      channel.current.onmessage = (e) => { if (e.data === "logout") lose(); };
    }
    return () => { setOnAuthLost(null); channel.current?.close(); };
  }, [lose]);

  const login = useCallback(async (email: string, password: string) => adopt(await post("login", { email, password })), [adopt]);
  const signup = useCallback(async (email: string, password: string, name: string) => adopt(await post("signup", { email, password, name })), [adopt]);
  const logout = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch {}
    channel.current?.postMessage("logout"); // sign every other tab out too
    lose();
  }, [lose]);
  const reloadUser = useCallback(async () => { const s = await refreshSession(); if (s) adopt(s); }, [adopt]);

  const value = useMemo(() => ({ status, user, login, signup, logout, adopt, reloadUser }), [status, user, login, signup, logout, adopt, reloadUser]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
