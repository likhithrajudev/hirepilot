/** A 402 from the server: a plan limit or a plan-only feature. Carries everything needed to offer an upgrade. */
export interface Paywall {
  code: "quota_exceeded" | "plan_required";
  feature: string;
  plan: string;
  limit: number | null;
  used: number | null;
  upgrade_to: string | null;
  message: string;
}
const isPaywall = (d: unknown): d is Paywall =>
  typeof d === "object" && d !== null && "code" in d && ["quota_exceeded", "plan_required"].includes((d as { code: string }).code) && typeof (d as { message?: unknown }).message === "string";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: string[] = [],
    public log = "",
    public retryAfter = 0,
    public paywall: Paywall | null = null,
  ) {
    super(message);
  }
}

/* ───────── session: the access token lives in memory only (never localStorage), so a script injected into the page
   cannot read it. The refresh token is an httpOnly cookie the browser sends on its own. ───────── */
let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const setOnAuthLost = (fn: (() => void) | null) => { onAuthLost = fn; };
let onPaywall: ((p: Paywall) => void) | null = null;
export const setOnPaywall = (fn: ((p: Paywall) => void) | null) => { onPaywall = fn; };

export interface Session {
  access_token: string;
  expires_in: number;
  user: AuthUser;
}
export interface AuthUser {
  id: number;
  email: string;
  name: string;
  avatar_url: string | null;
  role: string;
  is_platform_admin: boolean;
  email_verified: boolean;
  has_password: boolean;
  providers: string[];
  tenant: { id: number; name: string; slug: string; plan: string } | null;
}

async function toError(res: Response): Promise<ApiError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  const detail = body?.detail;
  const retry = Number(res.headers.get("Retry-After") ?? 0);
  if (res.status === 402 && isPaywall(detail)) return new ApiError(detail.message, 402, [], "", 0, detail);
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return new ApiError(detail.errors?.[0] ?? "Request failed", res.status, detail.errors ?? [], detail.log ?? "", retry);
  }
  if (Array.isArray(detail)) return new ApiError(detail.map((d) => d.msg).join("; "), res.status, [], "", retry);
  return new ApiError(typeof detail === "string" ? detail : `Request failed (${res.status})`, res.status, [], "", retry);
}

// Endpoints that work without a session (or that manage it): a 401 there is an answer, not an expired token.
const PUBLIC_AUTH = /^\/?auth\/(login|signup|refresh|logout|providers|password\/(forgot|reset))/;

let inflight: Promise<Session | null> | null = null;

/** Trade the refresh cookie for a new access token. One request at a time per tab, and one at a time across tabs
 *  (Web Locks), so two tabs never rotate the same cookie simultaneously. */
export function refreshSession(): Promise<Session | null> {
  if (inflight) return inflight;
  const run = async (): Promise<Session | null> => {
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
      if (!res.ok) { accessToken = null; return null; }
      const s = (await res.json()) as Session;
      accessToken = s.access_token;
      return s;
    } catch {
      return null;
    }
  };
  const locked: Promise<Session | null> = typeof navigator !== "undefined" && "locks" in navigator
    ? (navigator.locks.request("hp-refresh", () => run()) as unknown as Promise<Session | null>)
    : run();
  inflight = locked.finally(() => { inflight = null; });
  return inflight;
}

export async function raw(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api/${path.replace(/^\//, "")}`, { ...init, headers, credentials: "same-origin" });
  if (res.status === 401 && !retried && !PUBLIC_AUTH.test(path)) {
    // The 15-minute access token expired: refresh once and replay the request. If that fails, the session is gone.
    if (await refreshSession()) return raw(path, init, true);
    onAuthLost?.();
  }
  if (!res.ok) {
    const err = await toError(res);
    if (err.paywall) onPaywall?.(err.paywall); // the app opens an upgrade prompt; the caller still gets the error
    throw err;
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await raw(path, init);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

/** Compile LaTeX and return a blob: URL for the PDF. Throws ApiError with compiler errors/log on failure. */
export async function compilePdf(latex: string): Promise<string> {
  const res = await raw("/resumes/compile", json({ latex }));
  return URL.createObjectURL(await res.blob());
}

/** Download an export (pdf | tex | zip) via fetch so the auth header is sent. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await raw(path);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
