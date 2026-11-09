import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CodeLanguage, CodingProblem } from "@/lib/coding";

export type Difficulty = "easy" | "medium" | "hard";
export interface PracticeRow { id: string; title: string; difficulty: Difficulty; topic: string; points: number; case_count: number; status: "" | "tried" | "solved" }
export interface PracticeList { problems: PracticeRow[]; progress: { solved: number; total: number; by_difficulty: Record<Difficulty, { solved: number; total: number }> } }
export interface PracticeAttempt { created_at: string; language: CodeLanguage; mode: "examples" | "submit"; status: string; passed: number; total: number }
export interface PracticeDetail extends Omit<CodingProblem, "difficulty">, PracticeRow {
  languages: Record<CodeLanguage, { label: string; file: string; monaco: string }>; starters: Record<CodeLanguage, string>; attempts: PracticeAttempt[];
}

export const usePracticeProblems = () => useQuery({ queryKey: ["practice", "list"], queryFn: () => api<PracticeList>("/practice/problems") });
export const usePracticeProblem = (id: string) => useQuery({ queryKey: ["practice", "problem", id], queryFn: () => api<PracticeDetail>(`/practice/problems/${id}`), enabled: !!id });
export const DIFF_TONE = { easy: "ok", medium: "warn", hard: "bad" } as const;
