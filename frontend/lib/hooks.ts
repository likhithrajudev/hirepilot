"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "./api";
import { useAuth } from "./auth";
import type {
  ApplyKit,
  Interview,
  InterviewMemory,
  InterviewStart,
  InterviewSummary,
  AppSettings,
  AtsReport,
  Company,
  CompanyPage,
  Prefs,
  Profile,
  SystemInfo,
  TaskFull,
  TaskSummary,
  TemplateInfo,
  Job,
  JobDetail,
  JobFilters,
  JobStatus,
  RefreshStatus,
  Resume,
  ResumeListItem,
  TailorResult,
  Version,
} from "./types";

export const keys = {
  resumes: ["resumes"] as const,
  resume: (id: number) => ["resumes", id] as const,
  versions: (id: number) => ["resumes", id, "versions"] as const,
  jobs: (f: JobFilters) => ["jobs", f] as const,
  job: (id: number) => ["jobs", "detail", id] as const,
  refresh: ["jobs", "refresh-status"] as const,
  settings: ["settings"] as const,
  interviews: ["interviews"] as const,
  interviewMemory: ["interview-memory"] as const,
  interview: (id: number) => ["interviews", id] as const,
};

// ---------- resumes ----------
export const useResumes = () => useQuery({ queryKey: keys.resumes, queryFn: () => api<ResumeListItem[]>("/resumes") });

export const useResume = (id: number) =>
  useQuery({ queryKey: keys.resume(id), queryFn: () => api<Resume>(`/resumes/${id}`), staleTime: Infinity });

export function useCreateResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name: string; latex: string }) => api<Resume>("/resumes", json(b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.resumes }),
  });
}

export function useUpdateResume(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name?: string; latex?: string }) => api<Resume>(`/resumes/${id}`, json(b, "PUT")),
    onSuccess: (r) => {
      qc.setQueryData(keys.resume(id), r);
      qc.invalidateQueries({ queryKey: keys.resumes });
    },
  });
}

export function useDeleteResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/resumes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.resumes }),
  });
}

// ---------- versions ----------
export const useVersions = (id: number) =>
  useQuery({ queryKey: keys.versions(id), queryFn: () => api<Version[]>(`/resumes/${id}/versions`), enabled: id > 0 }); // id 0 means "no resume chosen yet": never request it

export function useCreateVersion(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<Version> & { latex: string; job_description?: string }) =>
      api<Version>(`/resumes/${id}/versions`, json(b)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.versions(id) });
      qc.invalidateQueries({ queryKey: keys.resumes });
    },
  });
}

export function useDeleteVersion(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vid: number) => api<void>(`/resumes/${id}/versions/${vid}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.versions(id) }),
  });
}

// ---------- tailoring ----------
export interface TailorInput {
  job_description: string;
  company?: string;
  job_title?: string;
  job_id?: number;
  instructions?: string;
  latex?: string;
}
export const useTailor = (id: number) =>
  useMutation({ mutationFn: (b: TailorInput) => api<TailorResult>(`/resumes/${id}/tailor`, json(b)) });

// ---------- jobs ----------
export function useJobs(filters: JobFilters) {
  return useQuery({
    queryKey: keys.jobs(filters),
    queryFn: () => {
      const p = new URLSearchParams({ sort: filters.sort ?? "score", limit: "200" });
      if (filters.q) p.set("q", filters.q);
      if (filters.level) p.set("level", filters.level);
      if (filters.status) p.set("status", filters.status);
      if (filters.location) p.set("location", filters.location);
      if (filters.exclude) p.set("exclude", filters.exclude);
      if (filters.hide_below) p.set("hide_below", String(filters.hide_below));
      if (filters.min_score) p.set("min_score", String(filters.min_score));
      return api<Job[]>(`/jobs?${p}`);
    },
  });
}

export const useJob = (id: number | null) =>
  useQuery({ queryKey: keys.job(id ?? 0), queryFn: () => api<JobDetail>(`/jobs/${id}`), enabled: id !== null });

export function useRefreshStatus(poll: boolean) {
  return useQuery({
    queryKey: keys.refresh,
    queryFn: () => api<RefreshStatus>("/jobs/refresh/status"),
    refetchInterval: (q) => (poll || q.state.data?.running ? 1500 : false),
  });
}

export function useRefreshJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { roles: string[]; locations: string[]; companies?: string[]; include_internships: boolean; include_all_levels: boolean }) =>
      api<{ started: boolean }>("/jobs/refresh", json(b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.refresh }),
  });
}

export function useScoreJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { resume_id: number; job_ids?: number[]; limit?: number }) =>
      api<{ scored: number }>("/jobs/score", json(b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useSetJobStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: JobStatus }) => api<Job>(`/jobs/${id}`, json({ status }, "PATCH")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

// ---------- settings ----------
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<AppSettings>("/settings") });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { openai_api_key?: string; clear_openai_key?: boolean; openai_model?: string }) =>
      api<AppSettings>("/settings", json(b, "PUT")),
    onSuccess: (s) => qc.setQueryData(keys.settings, s),
  });
}


// ---------- companies / profile / ATS / apply ----------
export const useCompanies = () =>
  useQuery({ queryKey: ["companies"], queryFn: () => api<Company[]>("/jobs/companies"), staleTime: 5 * 60_000 });

export const useProfile = () => useQuery({ queryKey: ["profile"], queryFn: () => api<Profile>("/profile") });

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Profile) => api<Profile>("/profile", json(b, "PUT")),
    onSuccess: (d) => qc.setQueryData(["profile"], d),
  });
}

export interface AtsInput {
  job_description: string;
  company?: string;
  job_title?: string;
  latex?: string;
}
export const useAts = (resumeId: number) =>
  useMutation({ mutationFn: (b: AtsInput) => api<AtsReport>(`/resumes/${resumeId}/ats`, json(b)) });

export const useApplyKit = (jobId: number) =>
  useMutation({
    mutationFn: (b: { resume_id: number; version_id?: number | null; tone?: string }) =>
      api<ApplyKit>(`/jobs/${jobId}/apply-kit`, json(b)),
  });


// ---------- preferences / system ----------
export const usePrefsQuery = () => {
  const { status } = useAuth();
  return useQuery({ queryKey: ["prefs"], queryFn: () => api<Prefs>("/preferences"), staleTime: Infinity, enabled: status === "authed" });
};

export function useSavePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Prefs) => api<Prefs>("/preferences", json(p, "PUT")),
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ["prefs"] });
      const previous = qc.getQueryData<Prefs>(["prefs"]);
      qc.setQueryData(["prefs"], p);
      return { previous };
    },
    onSuccess: (d) => qc.setQueryData(["prefs"], d),
    onError: (_error, _prefs, context) => {
      if (context?.previous) qc.setQueryData(["prefs"], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["prefs"] }),
  });
}

export const useSystem = () => useQuery({ queryKey: ["system"], queryFn: () => api<SystemInfo>("/system"), staleTime: 5_000 });

// ---------- templates / companies ----------
export const useTemplates = () => useQuery({ queryKey: ["templates"], queryFn: () => api<TemplateInfo[]>("/templates"), staleTime: 60_000, refetchInterval: (q) => (q.state.data?.some((t) => t.ats_parse === null) ? 2000 : false) });

export function useCreateFromTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { template_id: string; paper: string; name?: string }) => api<Resume>("/resumes/from-template", json(b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.resumes }),
  });
}

export const useCompanyPage = (p: { q: string; ats: string; sort: string; page: number; pageSize: number }) =>
  useQuery({
    queryKey: ["companies", p],
    queryFn: () => api<CompanyPage>(`/jobs/companies?${new URLSearchParams({ q: p.q, ats: p.ats, sort: p.sort, page: String(p.page), page_size: String(p.pageSize) })}`),
    placeholderData: (prev) => prev, // keep the old page on screen while the next one loads: no flicker
  });

// ---------- async AI tasks ----------
export interface TaskFilter { resume_id?: number; kind?: "tailor" | "ats"; active?: boolean; limit?: number }

export function useTasks(f: TaskFilter = {}, enabled = true) {
  const p = new URLSearchParams();
  if (f.resume_id !== undefined) p.set("resume_id", String(f.resume_id));
  if (f.kind) p.set("kind", f.kind);
  if (f.active) p.set("active", "true");
  p.set("limit", String(f.limit ?? 20));
  return useQuery({
    queryKey: ["tasks", f],
    queryFn: () => api<TaskSummary[]>(`/tasks?${p}`),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((t) => t.status === "queued" || t.status === "running") ? 1500 : false),
  });
}

export function useTask<T = unknown>(id: string | null) {
  return useQuery({ queryKey: ["task", id], queryFn: () => api<TaskFull<T>>(`/tasks/${id}`), enabled: !!id, staleTime: Infinity });
}

export function useStartTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { kind: "tailor" | "ats"; resume_id: number; payload: Record<string, unknown>; label?: string }) =>
      api<{ id: string }>("/tasks", json(b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      // Drop it from every cached list first, so no mounted panel still points at it, then forget its detail query.
      qc.setQueriesData<TaskSummary[]>({ queryKey: ["tasks"] }, (old) => old?.filter((t) => t.id !== id));
      qc.removeQueries({ queryKey: ["task", id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export const useCompanyIndex = () =>
  useQuery({ queryKey: ["company-index"], queryFn: () => api<{ name: string; domain: string | null; logo: boolean }[]>("/jobs/companies/index"), staleTime: 60 * 60_000 });


// ---------- billing ----------
export interface UsageRow { label: string; unit: string; period: "total" | "month"; used: number; limit: number | null; remaining: number | null; unmetered_by_own_key: boolean }
export interface SubscriptionInfo {
  plan: { id: string; name: string };
  mode: "test" | "stripe";
  can_manage: boolean;
  own_key: boolean;
  resets_at: string;
  usage: Record<string, UsageRow>;
  subscription: null | { status: "active" | "past_due" | "canceled"; interval: "month" | "year"; currency: "USD" | "INR"; provider: string; current_period_end: string; cancel_at_period_end: boolean; amount: number; has_portal: boolean };
}
export interface LedgerEntry { id: number; created_at: string; kind: string; plan: string | null; amount: number; currency: string; status: "paid" | "test" | "failed"; provider: string; url: string | null; note: string | null }

export const billingKeys = { subscription: ["billing", "subscription"] as const, invoices: ["billing", "invoices"] as const };

export const useSubscription = () => {
  const { status } = useAuth();
  return useQuery({ queryKey: billingKeys.subscription, queryFn: () => api<SubscriptionInfo>("/billing/subscription"), staleTime: 30_000, enabled: status === "authed" });
};
export const useInvoices = () => useQuery({ queryKey: billingKeys.invoices, queryFn: () => api<LedgerEntry[]>("/billing/invoices"), staleTime: 60_000 });

/** Money flows are never optimistic: the server confirms first, then every billing view is refetched. */
function useBillingMutation<TVars, TData>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }) });
}
export const useCheckout = () =>
  useBillingMutation((b: { plan: string; interval: string; currency: string }) => api<{ mode: "test" | "stripe"; url: string | null }>("/billing/checkout", json(b)));
export const useCancelPlan = () => useBillingMutation(() => api<{ cancel_at_period_end: boolean }>("/billing/cancel", { method: "POST" }));
export const useKeepPlan = () => useBillingMutation(() => api<{ cancel_at_period_end: boolean }>("/billing/resume", { method: "POST" }));
export const useBillingPortal = () => useMutation({ mutationFn: () => api<{ url: string }>("/billing/portal", { method: "POST" }) });

// ---------- mock interviews ----------
export const useInterviews = () => useQuery({ queryKey: keys.interviews, queryFn: () => api<InterviewSummary[]>("/interviews") });

export const useInterview = (id: number) =>
  useQuery({ queryKey: keys.interview(id), queryFn: () => api<Interview>(`/interviews/${id}`), enabled: id > 0, staleTime: Infinity });

export function useStartInterview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: InterviewStart) => api<Interview>("/interviews", json(b)),
    onSuccess: (iv) => { qc.setQueryData(keys.interview(iv.id), iv); qc.invalidateQueries({ queryKey: keys.interviews }); qc.invalidateQueries({ queryKey: ["billing"] }); },
  });
}

export function useDeleteInterview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/interviews/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => { qc.setQueryData<InterviewSummary[]>(keys.interviews, (l) => (l ?? []).filter((x) => x.id !== id)); qc.removeQueries({ queryKey: keys.interview(id) }); qc.invalidateQueries({ queryKey: keys.interviewMemory }); },
  });
}

// Personal practice context is isolated by the existing authentication cache lifecycle.
export const useInterviewMemory = () => useQuery({ queryKey: keys.interviewMemory, queryFn: () => api<InterviewMemory>("/interviews/memory") });
export function useSaveInterviewMemory() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: { enabled: boolean; notes: string }) => api<InterviewMemory>("/interviews/memory", json(body, "PUT")), onSuccess: (data) => qc.setQueryData(keys.interviewMemory, data) });
}
export function useClearInterviewMemory() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<InterviewMemory>("/interviews/memory", { method: "DELETE" }), onSuccess: (data) => qc.setQueryData(keys.interviewMemory, data) });
}
