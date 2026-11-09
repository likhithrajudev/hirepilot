from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- resumes ----------
class ResumeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    latex: str = Field(max_length=500_000)


class ResumeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    latex: Optional[str] = Field(default=None, max_length=500_000)


class ResumeOut(ORM):
    id: int
    name: str
    latex: str
    created_at: datetime
    updated_at: datetime


class ResumeListItem(ORM):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime
    version_count: int = 0


class VersionCreate(BaseModel):
    label: str = Field(default="", max_length=300)
    latex: str = Field(max_length=500_000)
    company: Optional[str] = None
    job_title: Optional[str] = None
    job_description: Optional[str] = None
    job_id: Optional[int] = None
    meta: Optional[dict[str, Any]] = None


class VersionOut(ORM):
    id: int
    resume_id: int
    label: str
    latex: str
    company: Optional[str]
    job_title: Optional[str]
    job_id: Optional[int]
    meta: Optional[dict[str, Any]]
    created_at: datetime


class CompileRequest(BaseModel):
    latex: str = Field(max_length=500_000)


class TailorRequest(BaseModel):
    job_description: str = Field(default="", max_length=60_000)
    company: Optional[str] = None
    job_title: Optional[str] = None
    job_id: Optional[int] = None
    instructions: Optional[str] = Field(default=None, max_length=2_000)
    # Tailor this text instead of the stored master (lets you tailor unsaved edits).
    latex: Optional[str] = Field(default=None, max_length=500_000)


class TailorResult(BaseModel):
    latex: str
    changes: list[str] = []
    matched_keywords: list[str] = []
    missing_keywords: list[str] = []
    estimated_fit: Optional[int] = None
    compile_ok: Optional[bool] = None  # None = could not check (no LaTeX engine)
    compile_errors: list[str] = []
    company: Optional[str] = None
    job_title: Optional[str] = None
    warnings: list[str] = []  # things a human should look at before accepting
    attempts: int = 1
    pages: Optional[int] = None


# ---------- jobs ----------
class JobOut(ORM):
    id: int
    source: str
    company: str
    title: str
    location: str
    url: str
    posted_at: Optional[datetime]
    level_tag: str
    status: str
    score: Optional[int]
    score_reason: Optional[str]
    scored_resume_id: Optional[int]
    score_detail: Optional[dict[str, Any]] = None
    fetched_at: datetime


class JobDetail(JobOut):
    description: str


class JobPatch(BaseModel):
    status: str = Field(pattern="^(new|saved|applied|ignored)$")


class RefreshRequest(BaseModel):
    roles: list[str] = Field(default_factory=lambda: ["engineer", "developer", "software"])
    locations: list[str] = Field(default_factory=list)  # empty = anywhere
    companies: list[str] = Field(default_factory=list)  # empty = every configured company
    include_internships: bool = True
    include_all_levels: bool = False


class ScoreRequest(BaseModel):
    resume_id: int
    job_ids: list[int] = Field(default_factory=list)  # empty = best unscored early-career jobs
    limit: int = Field(default=20, ge=1, le=60)


# ---------- settings ----------
class SettingsOut(BaseModel):
    openai_configured: bool
    openai_key_hint: str
    openai_key_source: str  # ui | env | none
    openai_model: str
    latex_available: bool


class SettingsUpdate(BaseModel):
    openai_api_key: Optional[str] = Field(default=None, max_length=300)
    clear_openai_key: bool = False
    openai_model: Optional[str] = Field(default=None, max_length=80)


class AtsRequest(BaseModel):
    job_description: str = Field(min_length=20, max_length=60_000)
    company: Optional[str] = None
    job_title: Optional[str] = None
    latex: Optional[str] = Field(default=None, max_length=500_000)
