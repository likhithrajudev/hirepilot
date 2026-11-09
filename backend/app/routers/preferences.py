"""App-wide preferences, data export/cleanup and a system status page for Settings."""
import json
import platform
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import engine, get_db
from ..deps import current_user
from ..models import AiTask, Job, Resume, ResumeVersion, User, UserJob
from ..services import cache, latex as latex_service, settings_store
from .profile import load_profile

router = APIRouter(tags=["preferences"])
KEY = "preferences"


class Preferences(BaseModel):
    # appearance
    theme: Literal["system", "light", "dark"] = "system"
    density: Literal["comfortable", "compact"] = "comfortable"
    accent: Literal["ember", "green", "indigo", "violet", "blue", "teal", "rose", "amber"] = "ember"
    smooth_scroll: bool = True
    reduce_motion: bool = False
    # editor
    editor_font_size: int = Field(default=13, ge=10, le=22)
    editor_word_wrap: bool = True
    editor_minimap: bool = False
    auto_compile: bool = True
    auto_compile_delay_ms: int = Field(default=1800, ge=500, le=6000)
    # ai
    ai_strictness: Literal["strict", "balanced"] = "strict"
    ai_creativity: float = Field(default=0.3, ge=0.0, le=1.0)
    ai_max_attempts: int = Field(default=3, ge=1, le=4)
    ai_default_instructions: str = Field(default="", max_length=600)
    cover_letter_tone: Literal["warm", "formal", "concise"] = "warm"
    # job search
    default_roles: str = Field(default="backend, software engineer, platform", max_length=300)
    include_internships: bool = True
    default_min_score: int = Field(default=0, ge=0, le=100)
    blocked_companies: list[str] = Field(default_factory=list, max_length=200)


def load_prefs(db: Session, user_id: int) -> Preferences:
    raw = settings_store.get_value(db, KEY, user_id)
    try:
        return Preferences(**json.loads(raw)) if raw else Preferences()
    except (ValueError, TypeError):
        return Preferences()


@router.get("/preferences", response_model=Preferences)
def get_prefs(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return load_prefs(db, user.id)


@router.put("/preferences", response_model=Preferences)
def put_prefs(body: Preferences, db: Session = Depends(get_db), user: User = Depends(current_user)):
    body.blocked_companies = sorted({c.strip() for c in body.blocked_companies if c.strip()})
    settings_store.set_value(db, KEY, body.model_dump_json(), user.id)
    return body


@router.get("/export")
def export_all(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Everything you created, as one JSON file. The OpenAI key is never included."""
    from .profile import load_profile

    resumes = db.scalars(select(Resume).where(Resume.user_id == user.id)).all()
    tracked = db.execute(select(Job, UserJob).join(UserJob, UserJob.job_id == Job.id).where(UserJob.user_id == user.id, UserJob.status.in_(["saved", "applied"]))).all()
    data = {
        "app": "hirepilot", "version": 1, "account": {"email": user.email, "name": user.name},
        "profile": load_profile(db, user).model_dump(), "preferences": load_prefs(db, user.id).model_dump(),
        "resumes": [{"id": r.id, "name": r.name, "latex": r.latex, "updated_at": r.updated_at.isoformat(),
                     "versions": [{"label": v.label, "company": v.company, "job_title": v.job_title, "latex": v.latex,
                                   "created_at": v.created_at.isoformat()} for v in r.versions]} for r in resumes],
        "job_tracking": [{"company": j.company, "title": j.title, "url": j.url, "status": uj.status, "score": uj.score} for j, uj in tracked],
    }
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="hirepilot-export.json"'})


class ClearJobs(BaseModel):
    keep_saved_and_applied: bool = True


@router.post("/data/clear-jobs")
def clear_jobs(body: ClearJobs, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Resets YOUR reviews and ignored roles. The shared job catalog is never touched."""
    stmt = delete(UserJob).where(UserJob.user_id == user.id)
    if body.keep_saved_and_applied:
        stmt = stmt.where(UserJob.status.not_in(["saved", "applied"]))
    n = db.execute(stmt).rowcount
    db.commit()
    cache.bump(f"jobs:{user.id}")
    return {"deleted": n}


@router.get("/system")
def system(db: Session = Depends(get_db), user: User = Depends(current_user)):
    def count(model, *where) -> int:
        return db.scalar(select(func.count()).select_from(model).where(*where)) or 0

    return {
        "api_version": "1.0.0", "python": platform.python_version(), "database": engine.dialect.name,
        "cache_backend": settings.cache_backend, "cache": dict(cache.stats), "latex_available": latex_service.latex_available(),
        # your own counts only; platform-wide numbers belong in the admin console
        "counts": {"resumes": count(Resume, Resume.user_id == user.id),
                   "versions": count(ResumeVersion, ResumeVersion.resume_id.in_(select(Resume.id).where(Resume.user_id == user.id))),
                   "jobs": count(Job), "ai_tasks": count(AiTask, AiTask.user_id == user.id)},
    }
