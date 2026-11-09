"""Invite links. The landing page is public (so a candidate sees who is asking and what will be shared before signing in); everything else needs their own account."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Assessment, AssessmentAttempt, InterviewSession, Tenant, TeamCandidate, TeamJob, User
from .interviews import StartBody, begin_session
from .teams import KIND_OF, _config

public = APIRouter(prefix="/invites", tags=["invites"])
router = APIRouter(prefix="/invites", tags=["invites"])


def _load(db: Session, token: str) -> tuple[TeamCandidate, TeamJob]:
    c = db.scalar(select(TeamCandidate).where(TeamCandidate.token == token))
    j = db.get(TeamJob, c.job_id) if c else None
    if not c or not j:
        raise HTTPException(404, "This invite link is not valid")
    return c, j


def _company(tenant) -> str:
    """A workspace is named after its owner by default ('Priya Sharma's workspace'), which is not a company a candidate should be told about."""
    n = tenant.name if tenant else ""
    return "" if not n or n.lower().endswith("workspace") else n


def _claim(c: TeamCandidate, user: User) -> None:
    if c.user_id and c.user_id != user.id:
        raise HTTPException(403, "This invite was already opened with a different account")
    c.user_id = user.id


@public.get("/{token}")
def info(token: str, db: Session = Depends(get_db)):
    c, j = _load(db, token)
    cfg = _config(j)
    tenant = db.get(Tenant, j.tenant_id)
    asm = db.get(Assessment, j.assessment_id) if j.assessment_id else None
    s = db.get(InterviewSession, c.session_id) if c.session_id else None
    at = db.get(AssessmentAttempt, c.attempt_id) if c.attempt_id else None
    monitored = bool(cfg.rules.get("tab_paste") or cfg.rules.get("camera"))
    return {"first_name": c.name.split()[0] if c.name else "", "role": j.title, "company": _company(tenant), "invited_by": (db.get(User, j.created_by).name if db.get(User, j.created_by) else ""), "open": j.status == "open" and j.published,
            "minutes": cfg.minutes, "type": cfg.type, "interviewer": cfg.persona, "monitored": monitored, "rules": cfg.rules,
            "assessment": None if not asm else {"title": asm.title, "duration_min": asm.duration_min},
            "interview": None if not s else {"session_id": s.id if s.status == "active" else None, "done": s.status == "done"},
            "attempt": None if not at else {"attempt_id": at.id if at.status == "active" else None, "done": at.status == "done"}}


class StartInterview(BaseModel):
    mode: Literal["voice", "text"] = "voice"
    consent_monitoring: bool = False


@router.post("/{token}/interview")
async def start_interview(token: str, body: StartInterview, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c, j = _load(db, token)
    if not j.published or j.status != "open":
        raise HTTPException(409, "This role is not taking interviews right now")
    _claim(c, user)
    if c.session_id:
        s = db.get(InterviewSession, c.session_id)
        if s and s.status == "active":
            db.commit()
            return {"session_id": s.id}
        raise HTTPException(409, "You have already completed this interview")
    cfg = _config(j)
    tenant = db.get(Tenant, j.tenant_id)
    payer = db.get(User, j.created_by) or user
    monitored = bool(cfg.rules.get("tab_paste") or cfg.rules.get("camera"))
    level = "mid" if "II" in cfg.seniority else "intern" if "intern" in cfg.seniority.lower() else "new_grad"
    sb = StartBody(kind=KIND_OF[cfg.type], role=j.title, company=_company(tenant), level=level, difficulty="medium", questions=6, minutes=cfg.minutes,
                   coding_problems=2, coding_language="python", proctored=monitored and body.consent_monitoring, mode=body.mode)
    try:
        started = await begin_session(db, user, sb, payer=payer, persona_name=cfg.persona, team_candidate_id=c.id)
    except HTTPException as e:
        if e.status_code == 402:   # the team is out of credits: that is not the candidate's problem or business
            raise HTTPException(409, "The hiring team cannot run this interview right now. Please let them know.")
        raise
    c.session_id = started["id"]
    if c.stage == "applied":
        c.stage = "interview"
    db.commit()
    return {"session_id": started["id"]}


@router.post("/{token}/assessment")
def start_assessment(token: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c, j = _load(db, token)
    if not j.published or j.status != "open" or not j.assessment_id:
        raise HTTPException(404, "There is no assessment for this role")
    _claim(c, user)
    if c.attempt_id:
        at = db.get(AssessmentAttempt, c.attempt_id)
        if at and at.status == "active":
            db.commit()
            return {"attempt_id": at.id}
        raise HTTPException(409, "You have already completed this assessment")
    at = AssessmentAttempt(assessment_id=j.assessment_id, candidate_id=c.id, user_id=user.id, answers={})
    db.add(at); db.flush()
    c.attempt_id = at.id
    if c.stage in ("applied", "interview"):
        c.stage = "assessment"
    db.commit()
    return {"attempt_id": at.id}
