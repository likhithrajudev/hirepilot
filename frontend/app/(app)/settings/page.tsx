"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bot, Briefcase, CreditCard, Laptop, LogOut, PanelLeftClose, PanelLeftOpen, CheckCircle2, Database, Eye, EyeOff, Keyboard, KeyRound, Monitor, Moon, Palette, Server, ShieldCheck, Sun, Terminal, UserRound, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/providers";
import { ProfileForm } from "@/components/ApplyDialog";
import BillingSection from "@/components/billing/BillingSection";
import { useDialog } from "@/components/Dialog";
import { Row, SectionCard, Segmented, Slider, Switch, TextField } from "@/components/settings-ui";
import { ErrorNote, PageHeader, timeAgo } from "@/components/ui";
import { api, download, json } from "@/lib/api";
import { useCompanyIndex, useProfile, useSettings, useSystem, useUpdateProfile, useUpdateSettings } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import type { Profile } from "@/lib/types";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "billing", label: "Plan & billing", icon: CreditCard },
  { id: "ai", label: "AI", icon: Bot },
  { id: "jobs", label: "Job search", icon: Briefcase },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Editor", icon: Terminal },
  { id: "data", label: "Data", icon: Database },
  { id: "system", label: "System", icon: Server },
  { id: "security", label: "Security", icon: ShieldCheck },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"];
const ACCENTS: { v: "ember" | "green" | "indigo" | "violet" | "blue" | "teal" | "rose" | "amber"; c: string }[] = [
  { v: "ember", c: "#c2410c" }, { v: "indigo", c: "#4f46e5" }, { v: "violet", c: "#7c3aed" }, { v: "blue", c: "#1d4ed8" }, { v: "rose", c: "#be123c" }, { v: "amber", c: "#b45309" },
];
const SHORTCUTS = [["[", "Collapse or expand the sidebar"], ["⌘ K", "Command palette"], ["/", "Command palette"], ["G then H", "Home"], ["G then R", "Resumes"], ["G then J", "Jobs"], ["G then C", "Companies"], ["G then S", "Settings"], ["N", "New resume"], ["⌘ S", "Save (in the editor)"], ["Esc", "Close dialogs and menus"]];

export default function Page() {
  return <Suspense fallback={null}><Settings /></Suspense>;
}

function Settings() {
  const router = useRouter();
  const sp = useSearchParams();
  const section = (SECTIONS.find((s) => s.id === sp.get("section"))?.id ?? "profile") as SectionId;
  const go = (id: SectionId) => router.replace(`/settings?section=${id}`, { scroll: false });
  const { saving } = usePrefs();
  const [compact, setCompact] = useState(false);
  useEffect(() => { try { setCompact(localStorage.getItem("hp_settings_nav") === "compact"); } catch {} }, []);
  const toggleCompact = () => { setCompact((c) => { try { localStorage.setItem("hp_settings_nav", !c ? "compact" : "full"); } catch {} return !c; }); };

  return (
    <div className="workspace-page">
      <PageHeader title="Settings" subtitle="Everything is stored on your own server. Changes save automatically." actions={<span className="chip bg-surface2 text-subtle" aria-live="polite">{saving ? "Saving…" : <><CheckCircle2 size={11} className="text-ok" /> All changes saved</>}</span>} />
      <div className={`mt-6 grid gap-6 transition-[grid-template-columns] duration-200 ${compact ? "md:grid-cols-[52px_minmax(0,1fr)]" : "md:grid-cols-[200px_minmax(0,1fr)]"}`}>
        <nav aria-label="Settings sections" className="md:sticky md:top-20 md:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button onClick={() => go(id)} aria-current={section === id ? "page" : undefined} title={compact ? label : undefined} aria-label={label}
                  className={`press relative flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${section === id ? "text-brand" : "text-muted hover:text-fg"}`}>
                  {section === id && <motion.span layoutId="settings-pill" className="absolute inset-0 rounded-lg bg-brand-soft" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                  <Icon size={15} className="relative shrink-0" /><span className={`relative ${compact ? "md:hidden" : ""}`}>{label}</span>
                </button>
              </li>
            ))}
          </ul>
          <button onClick={toggleCompact} aria-label={compact ? "Expand settings menu" : "Collapse settings menu"} title={compact ? "Expand" : "Collapse"} className="btn btn-ghost mt-2 hidden !h-9 w-full !justify-start gap-2.5 px-3 text-subtle md:inline-flex">
            {compact ? <PanelLeftOpen size={15} /> : <><PanelLeftClose size={15} /><span className="text-[13px]">Collapse</span></>}
          </button>
        </nav>
        <AnimatePresence mode="wait">
          <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="min-w-0 space-y-5">
            {section === "profile" && <ProfileSection />}
            {section === "billing" && <BillingSection />}
            {section === "ai" && <AiSection />}
            {section === "jobs" && <JobsSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "editor" && <EditorSection />}
            {section === "data" && <DataSection />}
            {section === "system" && <SystemSection />}
            {section === "security" && <SecuritySection />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function ProfileSection() {
  const toast = useToast();
  const profile = useProfile();
  const save = useUpdateProfile();
  const [draft, setDraft] = useState<Profile | null>(null);
  useEffect(() => { if (profile.data && !draft) setDraft(profile.data); }, [profile.data, draft]);
  const complete = !!(profile.data?.full_name && profile.data.email && profile.data.phone);
  return (
    <SectionCard title="Application profile" description="Pre-fills every application, your cover letters and the header of new resumes. It stays on your server and is sent to OpenAI only when you generate a letter."
      actions={<span className={`chip ${complete ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>{complete ? "Ready" : "Incomplete"}</span>}>
      {draft && <ProfileForm value={draft} onChange={setDraft} />}
      <div className="mt-5"><button className="btn btn-primary" disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft, { onSuccess: () => toast("Profile saved"), onError: (e) => toast(e.message, "error") })}>{save.isPending ? "Saving…" : "Save profile"}</button></div>
    </SectionCard>
  );
}

function AiSection() {
  const toast = useToast();
  const { confirm } = useDialog();
  const { prefs, update } = usePrefs();
  const { data, error } = useSettings();
  const upd = useUpdateSettings();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [model, setModel] = useState("");
  useEffect(() => { if (data) setModel(data.openai_model); }, [data]);
  return (
    <>
      <SectionCard title="OpenAI connection" actions={data?.openai_configured ? <span className="chip bg-ok-soft text-ok"><CheckCircle2 size={11} /> Connected · {data.openai_key_hint}</span> : <span className="chip bg-warn-soft text-warn">Not connected</span>}>
        <Row title="API key" hint={data?.openai_configured ? `Source: ${data.openai_key_source === "ui" ? "saved from this page" : "server environment variable"}. Encrypted at rest, never sent back to the browser.` : "Paste a key to enable tailoring, ATS checks and cover letters."} stack>
          <div className="relative max-w-md">
            <input className="input !pr-10 font-mono" type={show ? "text" : "password"} autoComplete="off" spellCheck={false} aria-label="OpenAI API key" value={key} onChange={(e) => setKey(e.target.value)} placeholder={data?.openai_configured ? "Paste a new key to replace it" : "sk-…"} />
            <button type="button" className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-subtle hover:text-fg" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide key" : "Show key"}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
        </Row>
        <Row title="Model" hint="Larger models write better; mini models are faster and cheaper.">
          <input list="models" className="input !w-48" aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" />
          <datalist id="models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist>
        </Row>
        <div className="flex gap-2 pt-4">
          <button className="btn btn-primary" disabled={upd.isPending || (!key && model === data?.openai_model)} onClick={() => upd.mutate({ openai_api_key: key || undefined, openai_model: model }, { onSuccess: () => { setKey(""); toast("OpenAI settings saved"); } })}>{upd.isPending ? "Saving…" : "Save connection"}</button>
          {data?.openai_key_source === "ui" && <button className="btn btn-danger" onClick={async () => (await confirm({ title: "Remove your OpenAI key?", body: "AI tailoring, ATS checks and cover letters stop working until you add a key again.", confirmLabel: "Remove key", danger: true })) && upd.mutate({ clear_openai_key: true }, { onSuccess: () => toast("Key removed", "info") })}>Remove key</button>}
        </div>
        {(upd.isError || error) && <div className="mt-3"><ErrorNote>{(upd.error ?? (error as Error)).message}</ErrorNote></div>}
      </SectionCard>

      <SectionCard title="Tailoring behaviour" description="Controls how the AI edits your resume. The preamble is never sent for editing, and every result is validated before you see it.">
        <Row title="Truthfulness" hint={prefs.ai_strictness === "strict" ? "Rejects and retries any result that adds a skill, tool or metric that is not already in your resume." : "Allows new terms but warns you in the review screen. Numbers and contact details are still enforced."}>
          <Segmented label="Truthfulness" value={prefs.ai_strictness} onChange={(v) => update({ ai_strictness: v })} options={[{ v: "strict", label: "Strict" }, { v: "balanced", label: "Balanced" }]} />
        </Row>
        <Row title="Rewrite freedom" hint="Low keeps your wording; high rephrases more boldly.">
          <Slider label="Rewrite freedom" value={prefs.ai_creativity} min={0} max={1} step={0.1} onCommit={(v) => update({ ai_creativity: v })} format={(v) => (v < 0.25 ? "Faithful" : v < 0.65 ? "Balanced" : "Bold")} />
        </Row>
        <Row title="Auto-repair attempts" hint="How many times the AI may fix its own LaTeX or fact errors before your original is kept.">
          <Segmented label="Attempts" value={String(prefs.ai_max_attempts)} onChange={(v) => update({ ai_max_attempts: Number(v) })} options={["1", "2", "3", "4"].map((n) => ({ v: n, label: n }))} />
        </Row>
        <Row title="Cover letter tone" hint="Used when preparing an application.">
          <Segmented label="Tone" value={prefs.cover_letter_tone} onChange={(v) => update({ cover_letter_tone: v })} options={[{ v: "warm", label: "Warm" }, { v: "formal", label: "Formal" }, { v: "concise", label: "Concise" }]} />
        </Row>
        <Row title="Standing instructions" hint="Added to every tailoring request, e.g. “Keep bullets under 20 words. No first person.”" stack>
          <TextField label="Standing instructions" multiline rows={3} maxLength={600} value={prefs.ai_default_instructions} placeholder="Optional" onCommit={(v) => update({ ai_default_instructions: v })} />
        </Row>
      </SectionCard>
    </>
  );
}

function JobsSection() {
  const { prefs, update } = usePrefs();
  const companies = useCompanyIndex();
  const [add, setAdd] = useState("");
  return (
    <SectionCard title="Job search defaults" description="Applied when you scan for jobs and when you browse the list.">
      <Row title="Default role keywords" hint="Comma separated. Used by “Find jobs”." stack><TextField label="Default role keywords" value={prefs.default_roles} onCommit={(v) => update({ default_roles: v })} /></Row>
      <Row title="Include internships" hint="Scans keep intern roles alongside new-grad and junior roles."><Switch label="Include internships" checked={prefs.include_internships} onChange={(v) => update({ include_internships: v })} /></Row>
      <Row title="Hide roles scoring below" hint="Only affects roles that have been scored against a resume."><Slider label="Minimum score" value={prefs.default_min_score} min={0} max={90} step={5} onCommit={(v) => update({ default_min_score: v })} format={(v) => (v === 0 ? "Off" : `${v}%`)} /></Row>
      <Row title="Hidden companies" hint="Their roles never appear in your list." stack>
        <div className="flex flex-wrap items-center gap-2">
          <AnimatePresence initial={false}>
            {prefs.blocked_companies.map((c) => (
              <motion.button key={c} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} className="chip press cursor-pointer bg-surface2 !px-2.5 !py-1 text-muted hover:text-fg" onClick={() => update({ blocked_companies: prefs.blocked_companies.filter((x) => x !== c) })} aria-label={`Show ${c} again`}>{c} <X size={11} /></motion.button>
            ))}
          </AnimatePresence>
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const n = add.trim(); if (n && !prefs.blocked_companies.includes(n)) update({ blocked_companies: [...prefs.blocked_companies, n] }); setAdd(""); }}>
            <input className="input !h-8 !w-44 text-xs" list="company-names" placeholder="Hide a company…" aria-label="Hide a company" value={add} onChange={(e) => setAdd(e.target.value)} />
            <datalist id="company-names">{companies.data?.map((c) => <option key={c.name} value={c.name} />)}</datalist>
            <button className="btn btn-sm" disabled={!add.trim()}>Hide</button>
          </form>
        </div>
      </Row>
    </SectionCard>
  );
}

function AppearanceSection() {
  const { prefs, update } = usePrefs();
  const themes = [{ v: "system", label: "System", icon: Monitor }, { v: "light", label: "Light", icon: Sun }, { v: "dark", label: "Dark", icon: Moon }] as const;
  return (
    <SectionCard title="Appearance" description="Applies instantly across the app.">
      <Row title="Theme" stack>
        <div className="grid max-w-md grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
          {themes.map(({ v, label, icon: Icon }) => (
            <button key={v} role="radio" aria-checked={prefs.theme === v} onClick={() => update({ theme: v })} className={`press flex flex-col items-center gap-2 rounded-xl border p-4 text-[13px] font-medium transition-colors ${prefs.theme === v ? "border-brand bg-brand-soft text-brand ring-2 ring-[var(--ring)]" : "border-line hover:border-line2"}`}><Icon size={18} />{label}</button>
          ))}
        </div>
      </Row>
      <Row title="Accent colour" hint="Buttons, links and highlights.">
        <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button key={a.v} role="radio" aria-checked={prefs.accent === a.v} aria-label={a.v} onClick={() => update({ accent: a.v })} className="press grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-[var(--surface)] transition-shadow" style={{ background: a.c, boxShadow: prefs.accent === a.v ? `0 0 0 2px var(--surface), 0 0 0 4px ${a.c}` : undefined }}>{prefs.accent === a.v && <CheckCircle2 size={14} className="text-white" />}</button>
          ))}
        </div>
      </Row>
      <Row title="Density" hint="Compact fits more on screen."><Segmented label="Density" value={prefs.density} onChange={(v) => update({ density: v })} options={[{ v: "comfortable", label: "Comfortable" }, { v: "compact", label: "Compact" }]} /></Row>
      <Row title="Smooth scrolling" hint="Inertial page scrolling. Turn off if you prefer native feel."><Switch label="Smooth scrolling" checked={prefs.smooth_scroll} onChange={(v) => update({ smooth_scroll: v })} /></Row>
      <Row title="Reduce motion" hint="Disables animations and transitions."><Switch label="Reduce motion" checked={prefs.reduce_motion} onChange={(v) => update({ reduce_motion: v })} /></Row>
    </SectionCard>
  );
}

function EditorSection() {
  const { prefs, update } = usePrefs();
  return (
    <SectionCard title="LaTeX editor" description="Applies to the resume editor and the AI review diff.">
      <Row title="Font size"><Slider label="Font size" value={prefs.editor_font_size} min={10} max={22} onCommit={(v) => update({ editor_font_size: v })} format={(v) => `${v}px`} /></Row>
      <Row title="Word wrap" hint="Wrap long lines instead of scrolling sideways."><Switch label="Word wrap" checked={prefs.editor_word_wrap} onChange={(v) => update({ editor_word_wrap: v })} /></Row>
      <Row title="Minimap"><Switch label="Minimap" checked={prefs.editor_minimap} onChange={(v) => update({ editor_minimap: v })} /></Row>
      <Row title="Auto-compile" hint="Rebuild the PDF preview while you type."><Switch label="Auto-compile" checked={prefs.auto_compile} onChange={(v) => update({ auto_compile: v })} /></Row>
      <Row title="Compile delay" hint="How long to wait after you stop typing."><Slider label="Compile delay" value={prefs.auto_compile_delay_ms} min={500} max={6000} step={250} onCommit={(v) => update({ auto_compile_delay_ms: v })} format={(v) => `${(v / 1000).toFixed(1)}s`} /></Row>
    </SectionCard>
  );
}

function DataSection() {
  const toast = useToast();
  const { confirm } = useDialog();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <SectionCard title="Your data" description="Everything you created lives in your own database. The OpenAI key is never included in exports.">
      <Row title="Export everything" hint="Resumes, versions, profile, preferences and the jobs you saved or applied to, as one JSON file.">
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await download("/export", "hirepilot-export.json"); toast("Export downloaded"); } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); } }}>Download JSON</button>
      </Row>
      <Row title="Clear scanned jobs" hint="Removes scanned roles you have not saved or applied to. Run a new scan afterwards.">
        <button className="btn btn-danger" onClick={async () => {
          if (!(await confirm({ title: "Clear scanned jobs?", body: "Roles you saved or applied to are kept. Everything else is removed and can be re-scanned.", confirmLabel: "Clear jobs", danger: true }))) return;
          try { const r = await api<{ deleted: number }>("/data/clear-jobs", json({ keep_saved_and_applied: true })); await qc.invalidateQueries({ queryKey: ["jobs"] }); await qc.invalidateQueries({ queryKey: ["companies"] }); toast(`Removed ${r.deleted} jobs`, "info"); } catch (e) { toast((e as Error).message, "error"); }
        }}>Clear jobs…</button>
      </Row>
    </SectionCard>
  );
}

function SystemSection() {
  const { data, isLoading } = useSystem();
  const hit = useMemo(() => { const h = data?.cache.hits ?? 0, m = data?.cache.misses ?? 0; return h + m ? Math.round((100 * h) / (h + m)) : null; }, [data]);
  const rows: [string, React.ReactNode][] = data ? [
    ["API version", data.api_version], ["Python", data.python], ["Database", data.database],
    ["Read cache", `${data.cache_backend}${hit !== null ? ` · ${hit}% hit rate (${data.cache.hits} hits)` : ""}`],
    ["LaTeX engine", data.latex_available ? <span className="text-ok">pdflatex ready</span> : <span className="text-warn">not installed</span>],
    ["Stored", `${data.counts.resumes} resumes · ${data.counts.versions} versions · ${data.counts.jobs} jobs · ${data.counts.ai_tasks} AI tasks`],
  ] : [];
  return (
    <>
      <SectionCard title="System status">
        {isLoading && <div className="skeleton h-28 w-full" />}
        <dl className="divide-y divide-line">{rows.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-[13px] first:pt-0 last:pb-0"><dt className="text-muted">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>)}</dl>
      </SectionCard>
      <SectionCard title="Keyboard shortcuts" actions={<Keyboard size={16} className="text-subtle" />}>
        <dl className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">{SHORTCUTS.map(([k, d]) => <div key={k + d} className="flex items-center justify-between text-[13px]"><dt className="text-muted">{d}</dt><dd className="flex gap-1">{k.split(" ").map((x, i) => <span key={i} className={x === "then" ? "px-0.5 text-xs text-subtle" : "kbd"}>{x}</span>)}</dd></div>)}</dl>
      </SectionCard>
    </>
  );
}

const PROVIDER_NAMES: Record<string, string> = { google: "Google", github: "GitHub", apple: "Apple" };

function deviceName(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} on ${os}`;
}

interface SessionRow { id: string; started_at: string; last_active: string; user_agent: string; ip: string; current: boolean }

function SecuritySection() {
  const toast = useToast();
  const { confirm } = useDialog();
  const { user, adopt, logout, reloadUser } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(user?.name ?? "");
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setName(user?.name ?? ""), [user?.name]);
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionRow[]>("/auth/sessions") });

  const saveName = async () => {
    try { await api("/auth/me", json({ name: name.trim() }, "PATCH")); await reloadUser(); toast("Name updated"); } catch (e) { toast((e as Error).message, "error"); }
  };
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const s = await api<import("@/lib/api").Session>("/auth/password/change", json({ current_password: cur, new_password: pw }));
      adopt(s); setCur(""); setPw("");
      await qc.invalidateQueries({ queryKey: ["sessions"] });
      toast(user?.has_password ? "Password changed. Other devices were signed out." : "Password set");
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  if (!user) return null;
  return (
    <>
      <SectionCard title="Account" actions={<span className="chip bg-brand-soft capitalize text-brand">{user.tenant?.plan ?? "free"} plan</span>}>
        <Row title="Name"><div className="flex gap-2"><input className="input !w-56" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" disabled={!name.trim() || name.trim() === user.name} onClick={saveName}>Save</button></div></Row>
        <Row title="Email" hint={user.email_verified ? "Verified by your sign-in provider." : "Not verified yet."}><span className="flex items-center gap-2 text-[13px] font-medium">{user.email}{user.email_verified && <CheckCircle2 size={14} className="text-ok" />}</span></Row>
        <Row title="Workspace" hint="Your data lives here. Only you can see it."><span className="text-[13px] font-medium">{user.tenant?.name}</span></Row>
      </SectionCard>

      <SectionCard title={user.has_password ? "Change password" : "Add a password"} description={user.has_password ? "Changing it signs out every other device." : "You signed up with a provider. Add a password to also sign in with your email."}>
        <form onSubmit={changePassword} className="max-w-md space-y-3">
          {err && <ErrorNote>{err}</ErrorNote>}
          {user.has_password && <div><label className="label" htmlFor="cur">Current password</label><input id="cur" type="password" autoComplete="current-password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} required /></div>}
          <div><label className="label" htmlFor="newpw">New password</label><input id="newpw" type="password" autoComplete="new-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 10 characters" required /></div>
          <button className="btn btn-primary" disabled={busy || pw.length < 10}>{busy ? "Saving…" : user.has_password ? "Change password" : "Set password"}</button>
        </form>
      </SectionCard>

      <SectionCard title="Sign-in methods" description="Signing in with a provider whose verified email matches your account links it automatically.">
        {(["google", "github", "apple"] as const).map((p) => {
          const linked = user.providers.includes(p);
          return (
            <Row key={p} title={PROVIDER_NAMES[p]} hint={linked ? "Connected" : "Not connected"}>
              {linked ? (
                <button className="btn btn-sm btn-danger" onClick={async () => {
                  if (!(await confirm({ title: `Disconnect ${PROVIDER_NAMES[p]}?`, body: "You can reconnect by signing in with it again.", confirmLabel: "Disconnect", danger: true }))) return;
                  try { await api(`/auth/oauth/${p}`, { method: "DELETE" }); await reloadUser(); toast(`${PROVIDER_NAMES[p]} disconnected`, "info"); } catch (e) { toast((e as Error).message, "error"); }
                }}>Disconnect</button>
              ) : <span className="chip bg-surface2 text-subtle">Not connected</span>}
            </Row>
          );
        })}
      </SectionCard>

      <SectionCard title="Active sessions" description="Devices currently signed in to your account."
        actions={<button className="btn btn-sm btn-danger" onClick={async () => { if (await confirm({ title: "Sign out everywhere?", body: "Every device, including this one, will be signed out immediately.", confirmLabel: "Sign out everywhere", danger: true })) { await api("/auth/logout-all", { method: "POST" }); await logout(); } }}><LogOut size={13} /> Sign out everywhere</button>}>
        {sessions.isLoading && <div className="skeleton h-16 w-full" />}
        <ul className="divide-y divide-line">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3.5 py-3.5 first:pt-0 last:pb-0">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface2 text-muted"><Laptop size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">{deviceName(s.user_agent)}{s.current && <span className="chip bg-ok-soft text-ok">This device</span>}</div>
                <div className="text-xs text-subtle">{s.ip || "unknown network"} · active {timeAgo(s.last_active)}</div>
              </div>
              {!s.current && <button className="btn btn-sm btn-ghost" onClick={async () => { await api(`/auth/sessions/${s.id}`, { method: "DELETE" }); await qc.invalidateQueries({ queryKey: ["sessions"] }); toast("Session ended", "info"); }}>Sign out</button>}
            </li>
          ))}
        </ul>
      </SectionCard>
    </>
  );
}
