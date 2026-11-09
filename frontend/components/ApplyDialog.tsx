"use client";

import { Check, CheckCircle2, Copy, Download, ExternalLink, FileText, Loader2, Rocket, Sparkles, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/app/providers";
import { download } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { useApplyKit, useProfile, useResumes, useUpdateProfile, useVersions } from "@/lib/hooks";
import type { Job, Profile } from "@/lib/types";
import { Modal, useDialog } from "./Dialog";
import { CompanyLogo, ErrorNote } from "./ui";

const REQUIRED: (keyof Profile)[] = ["full_name", "email", "phone"];
const FIELDS: { key: keyof Profile; label: string; placeholder?: string; span?: boolean }[] = [
  { key: "full_name", label: "Full name", placeholder: "Ada Lovelace" },
  { key: "email", label: "Email", placeholder: "ada@example.com" },
  { key: "phone", label: "Phone", placeholder: "+91 98765 43210" },
  { key: "city", label: "Current city", placeholder: "Bengaluru" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "github", label: "GitHub URL" },
  { key: "portfolio", label: "Portfolio / website" },
  { key: "degree", label: "Degree", placeholder: "B.E. Computer Science" },
  { key: "graduation_year", label: "Graduation year", placeholder: "2026" },
  { key: "work_authorization", label: "Work authorization", placeholder: "Authorized to work in India" },
  { key: "needs_sponsorship", label: "Needs visa sponsorship?", placeholder: "No" },
  { key: "notice_period", label: "Notice period / start date", placeholder: "Immediate" },
  { key: "expected_ctc", label: "Expected compensation", placeholder: "Open / ₹X LPA" },
];

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); }
        catch { toast("Could not copy. Select the text and copy it manually.", "error"); }
      }}
    >
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}

export function ProfileForm({ value, onChange, only }: { value: Profile; onChange: (p: Profile) => void; only?: (keyof Profile)[] }) {
  const fields = only ? FIELDS.filter((f) => only.includes(f.key)) : FIELDS;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="label" htmlFor={`pf-${f.key}`}>{f.label}</label>
          <input id={`pf-${f.key}`} className="input" value={value[f.key]} placeholder={f.placeholder} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

export default function ApplyDialog({ job, open, onClose, onApplied }: { job: Job | null; open: boolean; onClose: () => void; onApplied: () => void }) {
  const toast = useToast();
  const { confirm } = useDialog();
  const resumes = useResumes();
  const profile = useProfile();
  const saveProfile = useUpdateProfile();
  const [resumeId, setResumeId] = useState<number | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);
  const { prefs } = usePrefs();
  const [tone, setTone] = useState("warm");
  useEffect(() => setTone(prefs.cover_letter_tone), [prefs.cover_letter_tone]);
  const [draft, setDraft] = useState<Profile | null>(null);
  const versions = useVersions(resumeId ?? 0);
  const kit = useApplyKit(job?.id ?? 0);
  const [letter, setLetter] = useState("");
  const [opened, setOpened] = useState(false);

  useEffect(() => { if (open) { setOpened(false); kit.reset(); setLetter(""); } }, [open, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const list = resumes.data ?? [];
    if (!list.length || resumeId !== null) return;
    const saved = Number(localStorage.getItem("hp_job_resume"));
    setResumeId(list.some((r) => r.id === saved) ? saved : list[0].id);
  }, [resumes.data, resumeId]);
  useEffect(() => { if (profile.data && !draft) setDraft(profile.data); }, [profile.data, draft]);

  // Prefer a version already tailored for this job/company.
  useEffect(() => {
    if (!job || !versions.data) return;
    const match = versions.data.find((v) => v.job_id === job.id) ?? versions.data.find((v) => v.company === job.company);
    setVersionId(match?.id ?? null);
  }, [job, versions.data]);
  useEffect(() => { if (kit.data) setLetter(kit.data.cover_letter); }, [kit.data]);

  const missing = useMemo(() => (draft ? REQUIRED.filter((k) => !draft[k].trim()) : REQUIRED), [draft]);
  const noResume = (resumes.data?.length ?? 0) === 0;
  if (!job) return null;

  const prepare = async () => {
    if (draft && missing.length === 0 && JSON.stringify(draft) !== JSON.stringify(profile.data)) await saveProfile.mutateAsync(draft);
    if (resumeId === null) return;
    kit.mutate({ resume_id: resumeId, version_id: versionId, tone }, { onError: (e) => toast(e.message, "error") });
  };
  const resumePath = versionId ? `/resumes/${resumeId}/versions/${versionId}/export?format=pdf` : `/resumes/${resumeId}/export?format=pdf`;
  const label = versions.data?.find((v) => v.id === versionId)?.label ?? resumes.data?.find((r) => r.id === resumeId)?.name ?? "resume";
  const p = draft ?? profile.data;
  const quick = p ? ([["Name", p.full_name], ["Email", p.email], ["Phone", p.phone], ["LinkedIn", p.linkedin], ["GitHub", p.github], ["City", p.city], ["Notice", p.notice_period]] as const).filter(([, v]) => v) : [];

  return (
    <Modal
      open={open} onClose={onClose} size="xl"
      title={`Apply to ${job.company}`}
      description={<>We prepare everything and open the form; you review and press submit yourself.</>}
      icon={<Rocket size={18} />}
      footer={
        <>
          <span className="mr-auto text-xs text-subtle">{opened ? "Done submitting? Mark it so you can track it." : "Nothing is sent from here."}</span>
          <button
            className="btn"
            disabled={!opened}
            onClick={async () => { if (await confirm({ title: "Mark as applied?", body: `This moves "${job.title}" to your Applied list.`, confirmLabel: "Mark applied" })) { onApplied(); onClose(); toast("Marked as applied"); } }}
          >
            <CheckCircle2 size={14} /> I submitted it
          </button>
          <button className="btn btn-primary" disabled={!kit.data && missing.length > 0} onClick={() => { window.open(job.url, "_blank", "noopener,noreferrer"); setOpened(true); }}>
            <ExternalLink size={14} /> Open application page
          </button>
        </>
      }
    >
      <div className="space-y-6 pb-4 pt-1">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface2/60 p-3.5">
          <CompanyLogo name={job.company} size={42} />
          <div className="min-w-0"><div className="truncate text-sm font-semibold">{job.title}</div><div className="truncate text-xs text-muted">{job.company}{job.location && ` · ${job.location}`}</div></div>
        </div>

        {/* 1. details */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><UserRound size={15} className="text-brand" /> Your details</h3>
          {missing.length > 0 ? (
            <div className="space-y-3 rounded-xl border border-warn/30 bg-warn-soft/50 p-4">
              <p className="text-[13px] text-warn">Add these once and we reuse them on every application.</p>
              {draft && <ProfileForm value={draft} onChange={setDraft} only={[...REQUIRED, "linkedin", "github", "city", "degree", "graduation_year", "work_authorization", "notice_period"]} />}
              <button className="btn btn-primary btn-sm" disabled={missing.length > 0 || saveProfile.isPending} onClick={() => draft && saveProfile.mutate(draft, { onSuccess: () => toast("Details saved") })}>Save details</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {quick.map(([k, v]) => (
                <button key={k} title={`Copy ${k}`} className="chip press bg-surface2 !px-2.5 !py-1.5 text-muted hover:text-fg" onClick={() => navigator.clipboard.writeText(v).then(() => toast(`${k} copied`, "info"))}>
                  <span className="text-subtle">{k}</span> <span className="max-w-[180px] truncate font-medium text-fg">{v}</span> <Copy size={10} />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 2. resume */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileText size={15} className="text-brand" /> Resume</h3>
          {noResume ? <ErrorNote>Add a resume first, then come back.</ErrorNote> : (
            <div className="flex flex-wrap items-center gap-2">
              <select className="input !w-auto" aria-label="Resume" value={resumeId ?? ""} onChange={(e) => setResumeId(Number(e.target.value))}>
                {resumes.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select className="input !w-auto max-w-[260px]" aria-label="Version" value={versionId ?? ""} onChange={(e) => setVersionId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Master (untailored)</option>
                {versions.data?.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              <button className="btn" onClick={() => download(resumePath, `${label}.pdf`).catch((e) => toast(e.message, "error"))}><Download size={14} /> Download PDF</button>
              {!versionId && <span className="text-xs text-warn">Tailor a version for this job first for better odds.</span>}
            </div>
          )}
        </section>

        {/* 3. kit */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-brand" /> Cover letter &amp; answers</h3>
            <div className="flex items-center gap-2">
              <select className="input !h-8 !w-auto text-xs" aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="warm">Warm</option><option value="formal">Formal</option><option value="concise">Concise</option>
              </select>
              <button className="btn btn-primary btn-sm" disabled={kit.isPending || missing.length > 0 || noResume} onClick={prepare}>
                {kit.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {kit.data ? "Regenerate" : "Prepare with AI"}
              </button>
            </div>
          </div>
          {kit.isError && <ErrorNote>{kit.error.message}</ErrorNote>}
          {kit.isPending && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-4 w-full" />)}</div>}
          {kit.data && (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between"><span className="label !mb-0">Cover letter</span><CopyButton text={letter} /></div>
                <textarea data-lenis-prevent className="input h-52 resize-y text-[13px] leading-relaxed" value={letter} onChange={(e) => setLetter(e.target.value)} />
              </div>
              {Object.entries(kit.data.answers).map(([q, a]) => (
                <div key={q}>
                  <div className="mb-1.5 flex items-center justify-between"><span className="label !mb-0">{q}</span><CopyButton text={a} /></div>
                  <p className="rounded-lg bg-surface2 px-3 py-2.5 text-[13px] leading-relaxed text-fg/90">{a}</p>
                </div>
              ))}
              <div>
                <div className="mb-1.5 flex items-center justify-between"><span className="label !mb-0">Message to ask a current employee for a referral</span><CopyButton text={kit.data.referral_note} /></div>
                <p className="rounded-lg bg-surface2 px-3 py-2.5 text-[13px] leading-relaxed text-fg/90">{kit.data.referral_note}</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
