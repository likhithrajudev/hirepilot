from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, LargeBinary, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class InterviewRecording(Base):
    __tablename__ = "interview_recordings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(default=0)
    completed: Mapped[bool] = mapped_column(default=False)
    parts: Mapped[list["InterviewRecordingPart"]] = relationship(cascade="all, delete-orphan", order_by="InterviewRecordingPart.sequence")


class InterviewRecordingPart(Base):
    __tablename__ = "interview_recording_parts"
    __table_args__ = (UniqueConstraint("recording_id", "sequence", name="uq_recording_sequence"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    recording_id: Mapped[str] = mapped_column(ForeignKey("interview_recordings.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column()
    content: Mapped[bytes] = mapped_column(LargeBinary)


class CodingWorkspace(Base):
    __tablename__ = "coding_workspaces"
    session_id: Mapped[int] = mapped_column(ForeignKey("interview_sessions.id", ondelete="CASCADE"), primary_key=True)
    problems: Mapped[list] = mapped_column(JSON)
    active_index: Mapped[int] = mapped_column(default=0)
    solutions: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CodingRun(Base):
    __tablename__ = "coding_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True)
    problem_id: Mapped[str] = mapped_column(String(40))
    language: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(Text)
    source_hash: Mapped[str] = mapped_column(String(64))
    mode: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(30), default="running")
    result: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PracticeSubmission(Base):
    """Your own practice runs on the problem library (outside any interview). A problem counts as solved once a full submission is accepted."""
    __tablename__ = "practice_submissions"
    __table_args__ = (Index("ix_practice_user_problem", "user_id", "problem_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    problem_id: Mapped[str] = mapped_column(String(40))
    language: Mapped[str] = mapped_column(String(20))
    mode: Mapped[str] = mapped_column(String(10))   # examples | submit
    status: Mapped[str] = mapped_column(String(30))
    passed: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Contest(Base):
    """A timed round on the problem library with a live leaderboard (ICPC-style: problems solved, then least penalty)."""
    __tablename__ = "contests"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="weekly")  # weekly | themed | college
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_min: Mapped[int] = mapped_column(Integer, default=90)
    penalty_min: Mapped[int] = mapped_column(Integer, default=5)
    problem_ids: Mapped[Any] = mapped_column(JSON, default=list)
    created_by: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ContestRegistration(Base):
    __tablename__ = "contest_registrations"
    __table_args__ = (UniqueConstraint("contest_id", "user_id", name="uq_contest_user"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    contest_id: Mapped[int] = mapped_column(ForeignKey("contests.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ContestSubmission(Base):
    __tablename__ = "contest_submissions"
    id: Mapped[int] = mapped_column(primary_key=True)
    contest_id: Mapped[int] = mapped_column(ForeignKey("contests.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    problem_id: Mapped[str] = mapped_column(String(40))
    language: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(30))
    passed: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    minute: Mapped[float] = mapped_column(Float, default=0)   # minutes after the contest started
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TeamJob(Base):
    """A role a hiring team is filling. The AI interviewer for it is configured here and applies the same way to every candidate."""
    __tablename__ = "team_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, index=True)
    created_by: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | closed
    interviewer: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    published: Mapped[bool] = mapped_column(Boolean, default=False)  # candidates can only be invited once the interviewer is published
    assessment_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TeamCandidate(Base):
    __tablename__ = "team_candidates"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, index=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("team_jobs.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), default="")
    school: Mapped[str] = mapped_column(String(200), default="")
    stage: Mapped[str] = mapped_column(String(12), default="applied")  # applied | interview | assessment | panel | offer | rejected
    token: Mapped[str] = mapped_column(String(48), unique=True)       # the invite link
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    session_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    attempt_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    interview_done_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ai_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    recommendation: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # advance | hold | reject (a suggestion for a person)
    notes: Mapped[Any] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Assessment(Base):
    __tablename__ = "assessments"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, index=True)
    created_by: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    duration_min: Mapped[int] = mapped_column(Integer, default=60)
    cutoff: Mapped[int] = mapped_column(Integer, default=65)
    questions: Mapped[Any] = mapped_column(JSON, default=list)   # [{kind: mc|problem, ...}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AssessmentAttempt(Base):
    __tablename__ = "assessment_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"), index=True)
    candidate_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    answers: Mapped[Any] = mapped_column(JSON, default=dict)      # {question index: choice index | code results}
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)   # percent
    per_question: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="active")  # active | done


class Tenant(Base):
    """An account/workspace. Billing and plan limits attach here; every signup gets one."""

    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    plan: Mapped[str] = mapped_column(String(30), default="free")
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | suspended
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)  # stored lowercased
    name: Mapped[str] = mapped_column(String(200), default="")
    avatar_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)  # null for OAuth-only accounts
    role: Mapped[str] = mapped_column(String(20), default="owner")  # owner | admin | member
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)  # bump to invalidate every access token at once
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    tenant: Mapped[Tenant] = relationship()
    identities: Mapped[list["OAuthIdentity"]] = relationship(cascade="all, delete-orphan")


class OAuthIdentity(Base):
    __tablename__ = "oauth_identities"
    __table_args__ = (UniqueConstraint("provider", "subject", name="uq_oauth_provider_subject"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))  # google | github | apple
    subject: Mapped[str] = mapped_column(String(255))  # the provider's stable user id
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RefreshToken(Base):
    """One row per issued refresh token. Tokens rotate on every use and share a family, so reuse of an old token
    (a sign of theft) can revoke the whole family. Only a hash is stored."""

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family_id: Mapped[str] = mapped_column(String(32), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rotated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuthToken(Base):
    """Single-use emailed tokens (password reset)."""

    __tablename__ = "auth_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class UserJob(Base):
    """A user's own view of a catalog job: status, score and the hiring-manager review. The catalog (jobs) is shared."""

    __tablename__ = "user_jobs"
    __table_args__ = (Index("ix_user_jobs_rank", "user_id", "score"), Index("ix_user_jobs_status", "user_id", "status"))

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="new")
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    score_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    score_detail: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    scored_resume_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)  # null only for pre-accounts data
    tenant_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    latex: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    versions: Mapped[list["ResumeVersion"]] = relationship(
        back_populates="resume",
        cascade="all, delete-orphan",
        order_by="ResumeVersion.created_at.desc()",
    )


class ResumeVersion(Base):
    __tablename__ = "resume_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    resume_id: Mapped[int] = mapped_column(ForeignKey("resumes.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(300), default="")
    latex: Mapped[str] = mapped_column(Text)
    company: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    job_title: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    job_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    job_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    meta: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    resume: Mapped[Resume] = relationship(back_populates="versions")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_job_source_external"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(30))  # greenhouse | lever | ashby
    external_id: Mapped[str] = mapped_column(String(100))
    company: Mapped[str] = mapped_column(String(200), index=True)
    title: Mapped[str] = mapped_column(String(400))
    location: Mapped[str] = mapped_column(String(300), default="")
    url: Mapped[str] = mapped_column(String(1000))
    description: Mapped[str] = mapped_column(Text, default="")
    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    level_tag: Mapped[str] = mapped_column(String(30), default="other")  # intern | new_grad | junior | other
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)  # new|saved|applied|ignored
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    score_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scored_resume_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    score_detail: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)  # the hiring-manager evaluation
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class AiTask(Base):
    """A long-running AI job (tailor, ATS check). The row is the source of truth, so the UI can leave the page,
    switch tabs or reload and still find the result. Today a worker runs it in-process; the same row works unchanged
    when execution moves to a queue consumer."""

    __tablename__ = "ai_tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)  # tailor | ats
    status: Mapped[str] = mapped_column(String(12), default="queued", index=True)  # queued|running|done|error|cancelled
    progress: Mapped[str] = mapped_column(String(200), default="")
    resume_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    label: Mapped[str] = mapped_column(String(300), default="")
    payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    result: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class UsageEvent(Base):
    """One row per AI provider call: the ledger behind spend and usage analytics."""

    __tablename__ = "usage_events"
    __table_args__ = (Index("ix_usage_tenant_time", "tenant_id", "created_at"), Index("ix_usage_user_time", "user_id", "created_at"))

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    purpose: Mapped[str] = mapped_column(String(30), default="ai")  # tailor | ats | review | apply_kit
    model: Mapped[str] = mapped_column(String(60), default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    error: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class Subscription(Base):
    """A workspace's paid plan. `provider` is "internal" (test mode, no real money) or "stripe"."""

    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    plan: Mapped[str] = mapped_column(String(30))
    interval: Mapped[str] = mapped_column(String(10), default="month")  # month | year
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | past_due | canceled
    provider: Mapped[str] = mapped_column(String(20), default="internal")
    provider_customer_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, index=True)
    provider_subscription_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, unique=True)
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    canceled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class BillingEvent(Base):
    """Append-only money ledger: payments, renewals, refunds, failures, plan changes."""

    __tablename__ = "billing_events"
    __table_args__ = (Index("ix_billing_tenant_time", "tenant_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(30))  # payment | renewal | payment_failed | plan_change | cancel | refund
    plan: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    amount: Mapped[int] = mapped_column(Integer, default=0)  # minor units (cents / paise)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    status: Mapped[str] = mapped_column(String(20), default="paid")  # paid | test | failed
    provider: Mapped[str] = mapped_column(String(20), default="internal")
    provider_ref: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, unique=True)  # Stripe event id: makes replays harmless
    url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)


class FeatureUse(Base):
    """One row per metered action (a tailor, an ATS check, a role review...). Quotas are sums over these."""

    __tablename__ = "feature_uses"
    __table_args__ = (Index("ix_feature_tenant_feature_time", "tenant_id", "feature", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    feature: Mapped[str] = mapped_column(String(30))
    units: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class InterviewSession(Base):
    """A mock interview: the transcript is stored as it happens so a refresh or a dropped connection loses nothing."""

    __tablename__ = "interview_sessions"
    __table_args__ = (Index("ix_interview_user_time", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    tenant_id: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))  # behavioral | technical | resume | system_design
    role: Mapped[str] = mapped_column(String(200), default="")
    company: Mapped[str] = mapped_column(String(200), default="")
    level: Mapped[str] = mapped_column(String(20), default="new_grad")
    difficulty: Mapped[str] = mapped_column(String(10), default="medium")
    planned_questions: Mapped[int] = mapped_column(Integer, default=6)
    duration_min: Mapped[int] = mapped_column(Integer, default=20)  # the time box: the interviewer asks as many questions as fit
    team_candidate_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)  # set when a hiring team invited this person
    resume_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    job_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    persona_name: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)   # who the interviewer is, so name and voice always match
    persona_voice: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # OpenAI TTS voice id
    proctored: Mapped[bool] = mapped_column(Boolean, default=False)  # the candidate consented to integrity monitoring for this session
    events: Mapped[Any] = mapped_column(JSON, default=list)  # [{type, at, ms?, detail?}]: signals only, never video or audio
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | done
    turns: Mapped[Any] = mapped_column(JSON, default=list)  # [{who: interviewer|candidate, text, at, kind?, score?, note?}]
    report: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    overall: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class InterviewMemory(Base):
    """User-controlled context; feedback is retrieved from owned sessions, never copied across accounts."""

    __tablename__ = "interview_memory"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    reset_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AdminAudit(Base):
    __tablename__ = "admin_audit"
    id: Mapped[int] = mapped_column(primary_key=True)
    admin_id: Mapped[int] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(80))
    target: Mapped[str] = mapped_column(String(100))
    detail: Mapped[Any] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class HiringJob(Base):
    __tablename__ = "hiring_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    created_by: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    company: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text)
    requirements: Mapped[Any] = mapped_column(JSON, default=list)
    questions: Mapped[Any] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CandidateApplication(Base):
    __tablename__ = "candidate_applications"
    __table_args__ = (UniqueConstraint("job_id", "user_id", name="uq_application_job_user"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("hiring_jobs.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320))
    phone: Mapped[str] = mapped_column(String(60), default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    portfolio: Mapped[str] = mapped_column(String(1000), default="")
    answers: Mapped[Any] = mapped_column(JSON, default=list)
    resume_name: Mapped[str] = mapped_column(String(200))
    resume_text: Mapped[str] = mapped_column(Text)
    resume_data: Mapped[bytes] = mapped_column(LargeBinary)
    status: Mapped[str] = mapped_column(String(30), default="submitted", index=True)
    history: Mapped[Any] = mapped_column(JSON, default=list)
    ai_review: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    ai_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
