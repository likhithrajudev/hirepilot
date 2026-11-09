# Platform operations, recruiting, and interview assessment

## Where to start

- Admin portal: http://localhost:3000/admin (platform administrators only).
- Public roles: http://localhost:3000/careers.
- Candidate tracking: http://localhost:3000/applications.
- Interview practice: http://localhost:3000/interviews.

Both local services are rebuilt through Docker Compose. Existing Postgres and Redis volumes remain in place. The configured platform administrator account receives an Admin portal navigation link; no public role-escalation endpoint was added.

## Interview behavior

New sessions assign a specialist by type: Ananya for behavioral, Karthik for technical, Priya for resume deep dives, and Arjun for system design. The personality picker and the start request's persona control are removed. Existing sessions retain their stored identity and voice.

Automatic turn detection is now always enabled in voice interviews, with longer silence thresholds and a deferred response when a thought is judged incomplete. The Finish answer button and left prompt panel have been removed. Voice answers remain bounded to eight minutes. See RECORDINGS.md for automatic audio capture and playback.

The interviewer prompt now prioritizes continuity, assumptions, ownership, constraints, trade-offs, validation, and outcomes, calibrated to candidate level. The open question is explicitly supplied each turn. Follow-ups remain bounded to three per main question. When the server advances or wraps up despite an inconsistent model turn, it changes the text along with the turn kind, and the client aligns streamed speech with the validated reply. The interface shows elapsed time rather than an invented countdown, the current prompt, actual topic progress, a persistent answer control, and an optional live transcript.

These controls improve conversation structure; they do not guarantee human-level expertise or perfect model comprehension. The interviewer continues to disclose that it is AI and does not claim a real career.

## Formal reports

New reports support formal observations categorized as demonstrated strengths, development opportunities, and evidence. Each annotation references a valid candidate turn. Quoted text and timestamps are resolved from the saved transcript on the server rather than accepting model-invented quotations. Invalid or interviewer-turn citations are rejected.

Reports retain dimensions, question-level analysis, action plans, and the full timestamped transcript. The view supports browser print/save-as-PDF. Admins can export the full session as JSON and generate a new evidence report for completed sessions. Existing cached reports are preserved until explicitly regenerated. Times identify saved transcript turns, not word-level audio alignment. Assessment quality still depends on the provider model and the evidence supplied by the candidate.

## Admin capabilities

- Platform analytics for a selectable period: accounts, engaged users, AI calls, estimated spend, failures, average latency, interviews, applications, daily activity in UTC, and workflow breakdowns.
- Paginated user search and account detail, including subscription state and workspace usage.
- Block/unblock with a required reason. Blocking invalidates bearer sessions; unblocking does not revive revoked tokens. Platform administrators cannot block themselves or another platform administrator through this control.
- Workspace monthly-allowance reset with a support reason. Credits are appended as negative usage rows, not destructive ledger edits. Repeating a reset without intervening usage adds no extra credit. Shared workspace impact is disclosed. Password changes continue through the existing email-reset flow.
- Timestamped AI usage ledger and administrative audit trail.
- Interview inspection and detailed report generation after completion. Inspection, report generation, resume downloads, blocking, resets, job edits, AI reviews, and application-status changes are audited.

Every admin API is protected by the existing server-side platform_admin dependency. A hidden navigation link is not the security boundary. Cost totals are ledger estimates rather than reconciled provider invoices; speech and text billing units differ.

## Publishing and reviewing applicants

Admin → Hiring → Create a role collects title, company, location, description, explicit review criteria, and up to 12 custom professional questions. Drafts are private. Publishing makes the role available at a generated /careers/<slug> link; closing stops new applications.

Candidates sign in or create an account before submission so application ownership is tied to an authenticated user ID, not an unverified email claim. The form collects professional contact details, optional portfolio/location/phone, answers, and a selectable-text PDF resume up to 5 MB and 20 pages. The original questions are saved alongside answers, preserving meaning when the form changes later. Duplicate applications are rejected.

Candidates can track dated status updates and withdraw. Recruiters can inspect answers and download the resume, update status with a candidate-visible message, and run one or all unreviewed resume comparisons. The bulk review runs sequentially while the portal remains open and supports stopping after the current review. Saved results survive leaving the page. The pipeline loads up to 500 applications per role.

AI compares only explicit criteria against resume evidence. It does not change application statuses or make hiring decisions. Exact excerpts are checked against the uploaded resume; unsupported quotations cannot receive met/partial credit. Coverage is calculated consistently on the server (met=2, partial=1, not evidenced=0). Missing evidence does not establish missing ability. Invalid/incomplete model results save no score. Changing criteria invalidates old reviews; criteria changes during an in-flight review are detected. Reviewed resumes sort by criterion coverage with unreviewed applications following. AI review details remain admin-only.

## Data and validation

New additive tables: admin_audit, hiring_jobs, candidate_applications. Existing startup creates them using the application's established metadata workflow. Resume bytes are stored in Postgres and downloaded only after ownership/admin checks, with no-store headers. Listing applications defers loading PDF bytes and resume text. No existing database rows, infrastructure configuration, dependencies, or payment-provider contracts were replaced.

Executed validation:

- Backend: 155 tests passed, including new admin authorization, block/session invalidation, append-only reset, publication, application upload, ownership, duplicate, withdrawal, status history, verified AI evidence, criteria invalidation, malformed response, original-question snapshot, admin interview inspection, and timestamped report evidence coverage.
- Frontend: six tests passed for manual/automatic completion policy and bounded speech chunks; TypeScript passed.
- Production Next.js builds passed, including the new admin, careers, application, and job-detail routes. The final local frontend image includes explicit short-answer handling.
- Live health endpoint returned ok; unauthenticated admin access returned 401; public careers listing returned the actual empty list.
- Chrome: authenticated admin overview rendered real usage records and was visually inspected. The active interview accessibility state showed automatic persona assignment, current prompt, elapsed time, and Finish answer.
- Safari: careers listing and empty state visually inspected at 390 × 844.

Remaining verification/limitations: no live candidate account or job was invented/published for visual QA; application workflows were exercised against the isolated test database. The full job form, all admin subviews, every breakpoint/theme, browser console/hydration audit, print/PDF pagination, live provider ranking, and audible interview quality have not been exhaustively tested. OCR, automatic interview invitations, email status notifications, background review jobs across browser closure, and payment/subscription modifications are not included. Application updates are available in the candidate portal; real subscription changes remain in the existing billing flow.

Design reference reviewed: HackerRank's public product page, https://www.hackerrank.com/. HirePilot keeps its own graphite/electric-blue identity, navigation, and layouts.
