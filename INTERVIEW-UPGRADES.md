# Interview and identity upgrades

This update supersedes the graphite/emerald identity described in frontend/REDESIGN.md. The user approved extending the earlier frontend-only scope to the interview backend, account-scoped memory with controls, and graphite/electric blue.

## Delivered

- Six selectable AI interviewers: Ananya (reflective), Priya (structured), Meera (curious), Arjun (methodical), Karthik (probing), and Rohan (pragmatic). Random assignment remains available. Name and voice persist for the life of the session.
- Character-specific TTS pacing and delivery guidance, matched browser-fallback cadence, distinct portrait motion energy, framed interview-room composition, and audio-driven mouth animation without fabricated mouth movement during silence. Static picker portraits do not run continuous animation loops.
- Adaptive competency coverage, grounded follow-ups, fair experience-level calibration, clarification handling, and clearer protection against instructions embedded in resumes or memory. Report instructions request observed evidence and actionable drills rather than generic praise.
- Random prerecorded acknowledgement clips removed; no six-request preload on joining. Fallback queue no longer drops a segment while waiting for earlier audio. Stale fallback callbacks cannot change a new reply's state. Interrupted/fallback audio is disclosed, with replay for interrupted speech.
- Spoken text is split below the existing 500-character API limit, preserving long replies instead of falling back due to request validation.
- Graphite/electric-blue tokens, rail, favicon, and avatar staging. Retired green/teal saved accents render as blue without rewriting saved preference records. Success colors remain semantic status colors.

## Personal practice memory

A new interview_memory table stores enabled state, editable notes, a reset cutoff, and update time for one authenticated user. Existing database startup creates this new additive table. No existing data is deleted.

GET/PUT/DELETE /api/interviews/memory inspect, update, and clear memory. All routes require authentication and derive ownership from the authenticated user, never a submitted user ID. Memory starts paused until enabled in the Interview practice screen.

When enabled, live interviewer prompts receive saved context, up to three recent completed reports, and a bounded recent resume excerpt when no resume was selected for the current session. Resume ownership is checked again at retrieval. The UI exposes the notes, source reports, and resume used. Information is sent through the existing AI-provider integration during interviews; the control explains this.

Pause stops adding saved memory to subsequent prompts. Clear removes notes, pauses memory, and excludes sessions created before the reset cutoff from future retrieval, including after re-enabling. Interview history remains; prior information already spoken inside an ongoing interview remains in that session's transcript. Deleting a source interview removes it from future retrieval. Report scoring does not receive practice memory and remains grounded in the current transcript.

This is retrieval-based personalization, not self-training or fine-tuning of model weights. Prompt changes cannot guarantee perfect responses, and old feedback is explicitly treated as a hypothesis rather than a permanent judgment of ability.

## Validation

- Backend suite: 144 passed, including nine new memory/persona tests covering authentication, account isolation, bounds, prompt inclusion, report exclusion, pause, clear/re-enable, source deletion, and forged resume ownership.
- Existing PCM speech test now checks that selected character pacing reaches the provider call.
- Frontend: node --test tests/speech.test.mjs — 3 passed; npm run typecheck passed; production builds passed.
- Authenticated Chrome accessibility state showed all six personalities and the live memory panel. Desktop screenshots verified the deployed graphite/blue studio, portrait cards, memory controls and source reports. Cross-session memory was enabled for the current account, as requested, and the server-confirmed UI showed Active and Practice memory saved.
- Provider responses in tests are deterministic substitutes. Live AI answer quality, audible voice quality, microphone turn-taking, all viewport sizes, and all error paths have not been exhaustively evaluated. No paid AI interview was started by the agent for testing.
- No new dependencies, model replacement, or infrastructure configuration changes.

Both local backend and frontend are rebuilt via Docker Compose for localhost:3000; database and Redis volumes are retained.

Voice-delivery parameters were checked against the official OpenAI text-to-speech guide: https://developers.openai.com/api/docs/guides/text-to-speech
