/** Describes the six supported interview personas; names match the API allowlist. */
export const INTERVIEWERS = [
  { name: "Ananya", title: "The thoughtful coach", style: "Warm & reflective", focus: "A calm space to explain your thinking. Patient questions, precise follow-ups.", gender: "female", energy: 0.8, rate: 0.96 },
  { name: "Priya", title: "The precise evaluator", style: "Direct & structured", focus: "Get specific about your contribution, decisions, and measurable outcomes.", gender: "female", energy: 0.75, rate: 1.04 },
  { name: "Meera", title: "The curious explorer", style: "Curious & conversational", focus: "Explore ideas from a fresh angle and make your reasoning easy to follow.", gender: "female", energy: 1.15, rate: 1.02 },
  { name: "Arjun", title: "The systems thinker", style: "Calm & methodical", focus: "Slow down, weigh the alternatives, and explain why your approach works.", gender: "male", energy: 0.7, rate: 0.95 },
  { name: "Karthik", title: "The technical challenger", style: "Energetic & probing", focus: "Stress-test an idea with edge cases, failure modes, and deeper questions.", gender: "male", energy: 1.1, rate: 1.03 },
  { name: "Rohan", title: "The practical collaborator", style: "Relaxed & pragmatic", focus: "An approachable conversation about what you built and what you learned.", gender: "male", energy: 0.85, rate: 1 },
] as const;
export type InterviewerName = typeof INTERVIEWERS[number]["name"];
export const interviewerProfile = (name: string) => INTERVIEWERS.find((p) => p.name === name);

export const INTERVIEWER_BY_KIND = { behavioral: "Ananya", technical: "Karthik", resume: "Priya", system_design: "Arjun", coding: "Karthik" } as const;
