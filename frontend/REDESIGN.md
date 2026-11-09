# HirePilot UI overhaul

Original graphite-and-emerald career workspace, informed by HackerRank's task clarity without copying its layouts. Frontend only: no backend, database, infrastructure, dependency, endpoint, or authentication-contract changes.

## Audit and direction

Repeated card grids, weak page hierarchy, crowded filters, unavailable metrics shown as zero, missing request-error states, incomplete mobile focus management, an automatic accent overwrite, and optimistic preferences without rollback were the main issues. The redesign organizes the product around discovering opportunities, preparing applications, and practicing interviews.

## Implementation

- Shared semantic light/dark palettes, control sizing, gutters, page headers, focus treatment, empty/error states, arrow brand and favicon.
- Graphite navigation rail, workspace breadcrumb, compact mobile header, matching loading shell, and a drawer using the existing overlay focus trap and scroll lock.
- Home: next-action feature, practice shortcut, linked activity strip, role matches, launch checklist, recent documents, and honest unavailable-data states.
- Jobs: discovery heading, location panel, grouped filters and resume-review controls, pending/error feedback for status updates. Application metric links select the applied filter.
- Resumes: document previews, library context, visible editor links and deletion controls with pending/error feedback.
- Companies: shared layout, contained source filters, refresh announcement and retryable errors.
- Interviews: setup/check/session progress, native radio inputs, session summary, required-input guard, and explicit history errors.
- Settings: shared foundations and wrapping accent controls; saved accent choices are preserved.
- Landing, marketing navigation/footer, and the shared login/signup/forgot/reset shell now use the same identity.
- Existing editor, PDF, application, billing and live interview workflows remain; their specialized layouts were retained.

## Architecture and TanStack Query v5

App Router groups, authenticated gate, query keys, API payloads, invalidation and authentication cache isolation remain. Brand is a small shared component. The route template and AuthShell no longer require animation initialization to expose page content. No dependencies were added.

Preference mutations cancel an outstanding query, snapshot cached data, restore the prior value on failure, and invalidate on settlement. Query retry uses ApiError instead of any; gcTime is explicit. Billing still waits for server confirmation.

## Accessibility and responsiveness

Visible keyboard focus, alert semantics, decorative skeletons hidden from assistive technology, native interview radios, reduced-motion handling for counts, and focus trapping/restoration in mobile navigation. Filters have contained scrolling; the interview summary stacks; accent controls wrap; mobile header branding compacts.

Calculated text contrast: primary action 5.05:1, muted text 5.76:1, secondary text on white 4.77:1, rail text 8.99:1, rail action 10.82:1, dark muted text 8.98:1. These targeted checks are not full WCAG certification.

## Validation and performance

- Final `npm run typecheck`: passed.
- Final `npm run build`: passed; all 17 static pages generated and dynamic routes compiled.
- No standalone ESLint config, lint command, or frontend test suite exists. No separate lint/unit-test pass is claimed.
- Safari: landing and sign-in actually rendered and visually inspected at desktop size and 390 × 844. Landing-to-sign-in and brand-to-landing navigation worked. Real auth-provider availability appeared through the existing backend integration.
- Safari inspection found that the existing page-wide opacity animation could leave the sign-in route blank after navigation. Removing it and the auth entrance animations restored visible rendering.
- The final build reports login First Load JS of 114 kB versus 163 kB in the first build of this redesign pass, before removing the auth-shell animation dependency. Runtime latency and Core Web Vitals were not measured.

## Remaining limitations

Authenticated visual checks of Home, jobs, resumes, companies, settings, and interview setup remain. Chrome contained an authenticated session but refused automation input while its active state changed; the separate Safari preview was unauthenticated. No credentials were copied, accounts created, production data modified, AI sessions started, or paid operations exercised for verification.

Full keyboard walkthroughs, browser-console/hydration auditing, all themes/breakpoints, mutation rollback under network failure, PDF exports, and voice/camera behavior have not been validated end to end. Roadmap features remain unimplemented.

The preview uses localhost:3001, leaving the existing Docker service on port 3000 intact. Deployment and rebuilding that service were outside this frontend implementation.
