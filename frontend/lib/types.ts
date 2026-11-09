export interface Resume {
  id: number;
  name: string;
  latex: string;
  created_at: string;
  updated_at: string;
}
export interface ResumeListItem extends Omit<Resume, "latex"> {
  version_count: number;
}
export interface TailorResult {
  latex: string;
  changes: string[];
  matched_keywords: string[];
  missing_keywords: string[];
  estimated_fit: number | null;
  compile_ok: boolean | null;
  compile_errors: string[];
  company: string | null;
  job_title: string | null;
  warnings?: string[];
  attempts?: number;
  pages?: number | null;
}
export interface Version {
  id: number;
  resume_id: number;
  label: string;
  latex: string;
  company: string | null;
  job_title: string | null;
  job_id: number | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}
export type LevelTag = "intern" | "new_grad" | "junior" | "other";
export type JobStatus = "new" | "saved" | "applied" | "ignored";
export interface Job {
  id: number;
  source: string;
  company: string;
  title: string;
  location: string;
  url: string;
  posted_at: string | null;
  level_tag: LevelTag;
  status: JobStatus;
  score: number | null;
  score_reason: string | null;
  scored_resume_id: number | null;
  score_detail?: ScoreDetail | null;
  fetched_at: string;
}
export interface JobDetail extends Job {
  description: string;
}
export interface RefreshStatus {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  boards_total: number;
  boards_done: number;
  boards_failed: string[];
  found: number;
  added: number;
  error: string | null;
}
export interface AppSettings {
  openai_configured: boolean;
  openai_key_hint: string;
  openai_key_source: "ui" | "env" | "none";
  openai_model: string;
  latex_available: boolean;
}
export interface JobFilters {
  q?: string;
  level?: LevelTag | "";
  status?: JobStatus | "";
  location?: string;
  exclude?: string;
  hide_below?: number;
  min_score?: number;
  sort?: "score" | "recent" | "company";
}

export interface Company {
  name: string;
  ats: string;
  domain: string | null;
  logo: boolean;
  careers_url: string;
  jobs: number;
}
export interface Profile {
  full_name: string;
  email: string;
  phone: string;
  city: string;
  linkedin: string;
  github: string;
  portfolio: string;
  degree: string;
  graduation_year: string;
  work_authorization: string;
  needs_sponsorship: string;
  notice_period: string;
  expected_ctc: string;
  pronouns: string;
  extra_notes: string;
}
export interface AtsItem {
  term: string;
  found: boolean;
  evidence: string;
}
export interface AtsReport {
  overall: number;
  verdict: "strong" | "good" | "borderline" | "weak";
  dimensions: { key: string; label: string; score: number; note: string }[];
  must_have: AtsItem[];
  nice_to_have: AtsItem[];
  knockouts: { issue: string; severity: "high" | "medium" | "low"; fix: string }[];
  parse_findings: { level: "ok" | "warn" | "bad"; message: string }[];
  recruiter_skim: string;
  top_fixes: string[];
  bullet_feedback: { original: string; suggestion: string; why: string }[];
  ats_text: string;
  pages: number | null;
  compiled: boolean;
}
export interface ApplyKit {
  job: { id: number; title: string; company: string; url: string; location: string };
  resume: { id: number; version_id: number | null; label: string };
  cover_letter: string;
  answers: Record<string, string>;
  referral_note: string;
}

export interface Prefs {
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  accent: "ember" | "green" | "indigo" | "violet" | "blue" | "teal" | "rose" | "amber";
  smooth_scroll: boolean;
  reduce_motion: boolean;
  editor_font_size: number;
  editor_word_wrap: boolean;
  editor_minimap: boolean;
  auto_compile: boolean;
  auto_compile_delay_ms: number;
  ai_strictness: "strict" | "balanced";
  ai_creativity: number;
  ai_max_attempts: number;
  ai_default_instructions: string;
  cover_letter_tone: "warm" | "formal" | "concise";
  default_roles: string;
  include_internships: boolean;
  default_min_score: number;
  blocked_companies: string[];
}
export type TaskStatus = "queued" | "running" | "done" | "error" | "cancelled";
export interface TaskSummary {
  id: string;
  kind: "tailor" | "ats";
  status: TaskStatus;
  progress: string;
  resume_id: number | null;
  label: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  has_result: boolean;
}
export interface TaskFull<T = unknown> extends TaskSummary {
  result: T | null;
}
export interface TemplateInfo {
  id: string;
  name: string;
  tagline: string;
  best_for: string;
  font: string;
  ats_parse: number | null;
  pages: number | null;
}
export interface CompanyPage {
  items: Company[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  sources: { ats: string; count: number }[];
}
export interface SystemInfo {
  api_version: string;
  python: string;
  database: string;
  cache_backend: string;
  cache: Record<string, number>;
  latex_available: boolean;
  counts: Record<string, number>;
}

export type Verdict = "strong_yes" | "yes" | "maybe" | "no";
export interface ScoreDetail {
  verdict: Verdict;
  score: number;
  dimensions: { technical_fit: number; impact: number; scope_fit: number; learning_agility: number };
  must_haves: { term: string; met: boolean; evidence: string }[];
  knockouts: { issue: string; fix: string }[];
  strengths: string[];
  gaps: string[];
  interview_focus: string[];
  summary: string;
}

/* ───────── mock interviews ───────── */
export type InterviewKind = "behavioral" | "technical" | "resume" | "system_design" | "coding";
export type InterviewVerdict = "strong" | "good" | "mixed" | "not_yet";
export interface InterviewTurn { who: "interviewer" | "candidate"; text: string; at?: string; smalltalk?: boolean; kind?: "question" | "followup" | "chat" | "wrapup" | "closing" | null }
export interface InterviewDimension { score: number; comment: string }
export interface InterviewReport {
  overall: number;
  verdict: InterviewVerdict;
  summary: string;
  dimensions: Record<"communication" | "structure" | "depth" | "evidence" | "role_fit", InterviewDimension>;
  strengths: string[];
  improvements: string[];
  questions: { question: string; answer_summary: string; score: number; feedback: string; strong_answer_covers: string[] }[];
  practice_plan: string[];
  generated_at?: string; session_started_at?: string; session_finished_at?: string;
  evidence?: { turn_index: number; at: string | null; quote: string; category: "strength" | "development" | "observation"; assessment: string; next_step: string }[];
}
export interface InterviewSummary {
  id: number; created_at: string; finished_at: string | null; kind: InterviewKind; role: string; company: string; level: string; difficulty: string;
  planned_questions: number; duration_min: number; status: "active" | "done"; overall: number | null; answered: number; proctored: boolean;
  coding_enabled?: boolean;
  interviewer: { name: string; voice: string | null; gender: "female" | "male" | "neutral" };
}
export interface Integrity {
  monitored: boolean; score?: number; status?: "clean" | "review" | "flagged"; counts?: Record<string, number>; away_seconds?: number;
  timeline?: { type: string; at: string; ms: number; detail: string }[]; note?: string;
}
export interface Interview extends InterviewSummary {
  turns: InterviewTurn[]; report: InterviewReport | null; progress: { asked: number; planned: number }; integrity: Integrity;
}
export interface InterviewStart {
  kind: InterviewKind; role: string; company: string; level: string; difficulty: string; questions: number; resume_id?: number | null; job_id?: number | null; proctored?: boolean; mode?: "voice" | "text"; minutes?: number; coding_problems?: number; coding_language?: string;
}

export interface InterviewMemory {
  enabled: boolean;
  notes: string;
  updated_at: string | null;
  resume: { id: number; name: string } | null;
  sources: { id: number; kind: InterviewKind; role: string; summary: string; practice_plan: string[] }[];
}
