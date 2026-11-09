export type CodeLanguage = "python" | "javascript" | "cpp" | "java";
export interface CodingProblem {
  id: string; title: string; difficulty: string; statement: string; input_format: string; constraints: string;
  examples: { name: string; input: string; expected: string }[]; test_count: number; hidden_count: number;
}
export interface CodeResult {
  status: string; message?: string; passed: number; total: number;
  cases: { label: string; hidden: boolean; status: string; duration_ms: number; input?: string; expected?: string; output?: string; stderr?: string }[];
}
export interface CodingRun {
  id: string; problem_id: string; language: CodeLanguage; source_hash: string; mode: "examples" | "submit"; status: string;
  created_at: string; finished_at: string | null; result: CodeResult | null;
}
export interface CodingWorkspace {
  session_id: number; version: number; active_index: number; problems: CodingProblem[];
  solutions: Record<string, { language: CodeLanguage; sources: Partial<Record<CodeLanguage, string>> }>;
  languages: Record<CodeLanguage, { label: string; file: string; monaco: string }>;
  starters: Record<CodeLanguage, string>; runs: CodingRun[]; runner_configured: boolean; updated_at: string;
}
