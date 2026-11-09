# HirePilot

Paste your LaTeX resume, let AI tailor it to any job description, edit it in an Overleaf-style editor, export it, and find early-career roles at top tech companies.

| Layer | Stack |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, OpenAI SDK, `pdflatex` (TeX Live) |
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind v4, TanStack Query v5 + Devtools, Monaco editor |
| Infra | AWS CDK (TypeScript): ECS Fargate (ARM64) ×2, RDS Postgres, ALB, CloudFront, Secrets Manager |

## Features

- **LaTeX editor**: Monaco with LaTeX highlighting, side-by-side live PDF preview (auto-compile or `Cmd/Ctrl+S`), compiler error panel with full log.
- **AI tailoring**: paste a JD (or click *Tailor* on a job). The model rewords / reorders / trims *existing* content only (it is instructed never to invent experience), then the result is test-compiled and auto-repaired once if it fails. You review a **side-by-side diff** and accept or discard. Accepting saves a named **version** per company/role.
- **Export**: PDF, `.tex`, or `.zip` (both), for the live editor, the saved master, or any version.
- **Job hunt**: scans public Greenhouse / Lever / Ashby boards of ~48 top companies (edit `backend/app/data/companies.json`), keeps new-grad / junior / intern roles, drops senior and non-engineering titles, and scores matches against your resume with AI. Track `new / saved / applied / ignored`.
- **Bring your own key**: the OpenAI key is entered in Settings and stored encrypted (Fernet, key derived from `SECRET_KEY`). It is never returned by the API.

It finds and ranks jobs and prepares tailored resumes; **you** submit applications (auto-applying breaks most sites' terms and gets accounts banned).

## Run locally

```bash
# backend (SQLite, no pdflatex unless you install TeX Live)
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# frontend
cd frontend && npm install && npm run dev      # http://localhost:3000
```

Full fidelity (real `pdflatex` + Postgres): `docker compose up --build`.
Tests: `cd backend && .venv/bin/pytest`.

TanStack Query Devtools appear bottom-left in dev builds.

## Deploy to AWS

Prereqs: AWS CLI configured, Node 20+, **Docker running** (images are built on your machine; the stack is ARM64, which is native on Apple Silicon and uses `buildx`/QEMU elsewhere).

```bash
cd infra && npm install
npx cdk bootstrap          # once per account/region
npx cdk deploy             # ~15-20 min first time (RDS + CloudFront)
```

Outputs: `SiteUrl` and `AppTokenSecretArn`. Then:

```bash
aws secretsmanager get-secret-value --secret-id <AppTokenSecretArn> --query SecretString --output text
```

Open `SiteUrl` → **Settings** → paste the app token, then your OpenAI key.

```
Browser ─HTTPS─▶ CloudFront ─▶ ALB ─┬─ /api/* ▶ Fargate FastAPI (+TeX Live) ─▶ RDS Postgres
                (secret header)     └─ /*     ▶ Fargate Next.js
```

- The ALB only answers requests carrying a secret header CloudFront adds, and every `/api` call needs the `X-App-Token`.
- **Own domain instead of CloudFront**: `npx cdk deploy -c certificateArn=arn:aws:acm:...` serves HTTPS straight from the ALB (120 s timeout instead of CloudFront's 60 s) and you point a CNAME at the `AlbDnsName` output.
- Rough cost: ~US$75–90/month (NAT gateway, 2 Fargate tasks, db.t4g.micro, ALB). Tear down with `npx cdk destroy` (RDS keeps a final snapshot).

## Performance

Hot read endpoints (`/api/jobs`, `/api/jobs/companies`) cache their finished JSON (`CACHE_BACKEND=off|memory|redis`).
Writes bump a version number so invalidation is immediate and shared across instances with Redis; if Redis is down the
API falls back to Postgres. On 1 vCPU with 50k jobs this took the list endpoint from 108 to about 900 req/s. Method,
numbers and what each stage bought: [loadtest/RESULTS.md](loadtest/RESULTS.md).

## Accounts and sign-in

Email + password, plus Google, GitHub and Apple. Every resume, task, setting, review and job status belongs to one
account; the scanned job catalog is shared and each user keeps a private overlay on it (status, score, review).

**Sessions.** A 15-minute JWT access token is held in memory only (never in localStorage). A refresh token lives in an
`httpOnly` cookie, is stored hashed, and rotates on every use. Reusing an old one outside a 10-second grace window
revokes the whole session family. Changing a password or "sign out everywhere" invalidates access tokens immediately.

**Social sign-in** turns on when credentials are present. Redirect URI for each provider:
`{PUBLIC_BASE_URL}/api/auth/oauth/{google|github|apple}/callback`

| Provider | Environment variables |
|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Apple | `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the .p8 contents) |

An OAuth login links to an existing account **only when the provider reports the email as verified**.

**Data from before accounts existed** is claimed by the account whose email equals `CLAIM_LEGACY_EMAIL` (or, if unset, the
very first account). `ADMIN_EMAILS` lists platform administrators.

**Before deploying:** set `SECRET_KEY` to 32+ random bytes (rotating it later makes stored OpenAI keys unreadable),
`PUBLIC_BASE_URL` to the site's https origin, `COOKIE_SECURE=true`, include that origin in `CORS_ORIGINS`, and set
`SMTP_HOST` (without it, password-reset links are written to the server log). Login throttling is per instance unless Redis is configured.

## Known limitations / next steps

- Schema is created with `create_all`; add Alembic before changing models in a live deployment.
- Job-refresh progress is held in memory, so the API service runs a single task.
- Monaco's JS is loaded from jsDelivr at runtime; self-host it if you need an offline/locked-down deployment.
- Email verification is not sent yet (needs SMTP); OAuth sign-ins are verified by the provider.
- AI tailoring through CloudFront must finish in 60 s; typical resumes take 15–40 s.
