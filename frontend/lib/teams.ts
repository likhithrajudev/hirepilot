import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/* ───────── contests ───────── */
export interface ContestRow { id: number; name: string; kind: "weekly" | "themed" | "college"; starts_at: string; ends_at: string; duration_min: number; penalty_min: number; state: "upcoming" | "live" | "ended"; registered_count: number; registered: boolean; problem_count: number }
export interface ContestList { live: ContestRow[]; upcoming: ContestRow[]; past: ContestRow[]; can_create: boolean }
export interface ContestDetail extends ContestRow { problems: { id: string; title: string; difficulty: "easy" | "medium" | "hard"; points: number; status: "" | "tried" | "solved" }[] }
export interface Standings { problems: { id: string; label: string }[]; rows: { rank: number; name: string; you: boolean; score: number; penalty: number; cells: ({ minute: number | null; wrong: number } | null)[] }[] }
export const useContests = () => useQuery({ queryKey: ["contests"], queryFn: () => api<ContestList>("/contests"), refetchInterval: 30_000 });
export const useContest = (id: number) => useQuery({ queryKey: ["contests", id], queryFn: () => api<ContestDetail>(`/contests/${id}`), enabled: id > 0, refetchInterval: 30_000 });
export const useStandings = (id: number, live: boolean) => useQuery({ queryKey: ["contests", id, "standings"], queryFn: () => api<Standings>(`/contests/${id}/standings`), enabled: id > 0, refetchInterval: live ? 15_000 : false });

/* ───────── hiring teams ───────── */
export interface TeamJobRow { id: number; title: string; location: string; status: "open" | "closed"; published: boolean; assessment_id: number | null; candidates: number; interviewed: number; recommended: number }
export interface Card { id: number; name: string; email: string; school: string; stage: string; ai_score: number | null; recommendation: "advance" | "hold" | "reject" | null; tags: string[]; invite_path: string; joined: boolean; created_at: string }
export interface Pipeline {
  job: { id: number; title: string; location: string; published: boolean; status: string };
  columns: { stage: string; name: string; cards: Card[] }[]; rejected: Card[];
  summary: { invited: number; interviewed: number; recommended: number; assessed: number; finished_last_day: number; recommended_last_day: number };
}
export interface QuestionPlan { text: string; comp: string; minutes: number; followups: "None" | "Up to 1" | "Up to 2" | "Up to 3" }
export interface InterviewerConfig { type: "Technical" | "Behavioral" | "Coding" | "Mixed"; minutes: number; language: string; seniority: string; competencies: string[]; questions: QuestionPlan[]; persona: string; intensity: number; rules: Record<string, boolean>; published: boolean }
export interface JobDetail { id: number; title: string; location: string; status: "open" | "closed"; assessment_id: number | null; interviewer: InterviewerConfig }
export interface CandidateDetail extends Card {
  job: { id: number; title: string }; notes: { by: string; text: string; at: string }[];
  interview: null | { status: string; started_at: string; finished_at: string | null; minutes: number; proctored: boolean; report: null | InterviewReportLite; integrity: { monitored: boolean; score?: number; status?: string; counts?: Record<string, number>; away_seconds?: number } };
  assessment: null | { title: string; status: string; score: number | null; cutoff: number | null; per_question: { index: number; kind: string; points: number; earned: number }[] | null; started_at: string; finished_at: string | null };
}
export interface InterviewReportLite {
  overall: number; verdict: string; summary: string; dimensions: Record<string, { score: number; comment: string }>; strengths: string[]; improvements: string[];
  questions: { question: string; answer_summary: string; score: number; feedback: string }[]; evidence?: { at?: string; quote: string; category: string; assessment: string; next_step: string }[];
}
export const useTeamJobs = () => useQuery({ queryKey: ["teams", "jobs"], queryFn: () => api<TeamJobRow[]>("/teams/jobs") });
export const usePipeline = (id: number) => useQuery({ queryKey: ["teams", "pipeline", id], queryFn: () => api<Pipeline>(`/teams/jobs/${id}/pipeline`), enabled: id > 0, refetchInterval: 30_000 });
export const useTeamJob = (id: number) => useQuery({ queryKey: ["teams", "job", id], queryFn: () => api<JobDetail>(`/teams/jobs/${id}`), enabled: id > 0 });
export const useCandidate = (id: number) => useQuery({ queryKey: ["teams", "candidate", id], queryFn: () => api<CandidateDetail>(`/teams/candidates/${id}`), enabled: id > 0 });

/* ───────── assessments ───────── */
export interface AssessmentRow { id: number; title: string; duration_min: number; cutoff: number; questions: number; started: number; completed: number }
export type AssessmentQuestion = { kind: "mc"; text: string; code?: string; options: string[]; correct: number; points: number } | { kind: "problem"; problem_id: string; points: number };
export interface AssessmentDef { id?: number; title: string; duration_min: number; cutoff: number; questions: AssessmentQuestion[] }
export interface AssessmentResults {
  assessment: { id: number; title: string; duration_min: number; cutoff: number; questions: number };
  summary: { invited: number; started: number; completed: number; median: number | null; above_cutoff: number };
  rows: { candidate_id: number; name: string; school: string; score: number | null; seconds: number | null; status: string }[]; histogram: number[]; hardest: { index: number; label: string; percent: number }[];
}
export const useAssessments = () => useQuery({ queryKey: ["assessments"], queryFn: () => api<AssessmentRow[]>("/assessments") });
export const useAssessmentResults = (id: number) => useQuery({ queryKey: ["assessments", id, "results"], queryFn: () => api<AssessmentResults>(`/assessments/${id}/results`), enabled: id > 0, refetchInterval: 30_000 });

/* ───────── invites ───────── */
export interface InviteInfo {
  first_name: string; role: string; company: string; invited_by: string; open: boolean; minutes: number; type: string; interviewer: string; monitored: boolean; rules: Record<string, boolean>;
  assessment: null | { title: string; duration_min: number }; interview: null | { session_id: number | null; done: boolean }; attempt: null | { attempt_id: number | null; done: boolean };
}
export const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };
export const fullUrl = (path: string) => (typeof window === "undefined" ? path : `${window.location.origin}${path}`);
