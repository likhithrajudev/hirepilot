from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import CodingRun, CodingWorkspace, InterviewSession, User, utcnow
from ..services import coding, ratelimit
from ..services.coding_problems import LANGUAGES, PROBLEMS, STARTERS

router = APIRouter(prefix="/interviews", tags=["coding"])


@router.get("/coding/status")
async def runner_status():
    return await coding.runner_status()


def own(db, user, sid, write=False):
    session = db.scalar(select(InterviewSession).where(InterviewSession.id == sid).with_for_update())
    if not session or session.user_id != user.id and (write or not user.is_platform_admin):
        raise HTTPException(404, "Interview not found")
    if write and session.status != "active":
        raise HTTPException(409, "This interview has ended; the workspace is read-only")
    ws = db.get(CodingWorkspace, sid)
    if not ws:
        raise HTTPException(404, "This interview has no coding workspace")
    return ws


@router.get("/{sid}/coding")
def get_workspace(sid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return coding.public(db, own(db, user, sid))


class Save(BaseModel):
    version: int = Field(ge=0)
    problem_id: str
    language: Literal["python", "javascript", "cpp", "java"]
    source: str = Field(max_length=50000)


@router.put("/{sid}/coding")
def save(sid: int, body: Save, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ws = own(db, user, sid, write=True)
    if body.version != ws.version:
        raise HTTPException(409, "This workspace changed in another tab. Reload it before saving.")
    if body.problem_id != ws.problems[ws.active_index]:
        raise HTTPException(409, "Only the active problem can be edited")
    if len(body.source.encode()) > 50000:
        raise HTTPException(422, "Source code must be at most 50 KB")
    solution = ws.solutions[body.problem_id]
    ws.solutions = {**ws.solutions, body.problem_id: {"language": body.language, "sources": {**solution["sources"], body.language: body.source}}}
    ws.version += 1; ws.updated_at = utcnow()
    db.commit()
    return {"version": ws.version, "updated_at": ws.updated_at, "source_hash": coding.source_hash(body.source)}


class Run(BaseModel):
    version: int = Field(ge=0)
    mode: Literal["examples", "submit"] = "examples"


@router.post("/{sid}/coding/run")
async def run(sid: int, body: Run, db: Session = Depends(get_db), user: User = Depends(current_user)):
    allowed, retry = ratelimit.hit(f"code-run:{user.id}", 10, 60)
    if not allowed:
        raise HTTPException(429, "Run limit reached. Wait before running again.", headers={"Retry-After": str(retry)})
    ws = own(db, user, sid, write=True)
    if body.version != ws.version:
        raise HTTPException(409, "Save the current code before running it")
    now = datetime.now(timezone.utc)
    if db.scalar(select(CodingRun.id).where(CodingRun.session_id == sid, CodingRun.status == "running", CodingRun.created_at > now - timedelta(seconds=90))):
        raise HTTPException(409, "A run is already in progress for this interview")
    if db.scalar(select(func.count()).select_from(CodingRun).where(CodingRun.session_id == sid)) >= 120:
        raise HTTPException(429, "This interview has reached its 120-run limit")
    pid = ws.problems[ws.active_index]; solution = ws.solutions[pid]
    language = solution["language"]; source = solution["sources"][language]
    if not source.strip(): raise HTTPException(422, "Write some code before running")
    record = CodingRun(id=str(uuid4()), session_id=sid, problem_id=pid, language=language, source=source,
                       source_hash=coding.source_hash(source), mode=body.mode, status="running")
    db.add(record); db.commit()
    cases = [c for c in PROBLEMS[pid]["cases"] if body.mode == "submit" or not c["hidden"]]
    try:
        result = await coding.execute(language, source, cases)
        record.status = result["status"]; record.result = result
    except HTTPException as e:
        record.status = "unavailable"; record.result = {"message": str(e.detail), "status": "unavailable", "cases": [], "passed": 0, "total": len(cases)}
        record.finished_at = utcnow(); db.commit()
        raise
    record.finished_at = utcnow(); db.commit()
    return coding.run_public(record)


class Next(BaseModel):
    version: int = Field(ge=0)
    skip: bool = False


@router.post("/{sid}/coding/next")
def next_problem(sid: int, body: Next, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ws = own(db, user, sid, write=True)
    if body.version != ws.version: raise HTTPException(409, "Reload this workspace before continuing")
    if ws.active_index + 1 >= len(ws.problems): raise HTTPException(409, "You are on the final problem. Discuss your solution or wrap up the interview.")
    pid = ws.problems[ws.active_index]; solution = ws.solutions[pid]
    accepted = db.scalar(select(CodingRun.id).where(CodingRun.session_id == sid, CodingRun.problem_id == pid,
        CodingRun.language == solution["language"], CodingRun.source_hash == coding.source_hash(solution["sources"][solution["language"]]),
        CodingRun.mode == "submit", CodingRun.status == "accepted"))
    if not accepted and not body.skip:
        raise HTTPException(409, "Pass the full suite for your current code, or explicitly skip this problem")
    session = db.get(InterviewSession, sid)
    session.turns = [*session.turns, {"who": "candidate", "kind": "workspace", "text": f"{'Skipped' if body.skip else 'Completed'} coding problem: {PROBLEMS[pid]['title']}.", "smalltalk": True, "at": utcnow().isoformat()}]
    ws.active_index += 1; ws.version += 1; ws.updated_at = utcnow()
    next_title = PROBLEMS[ws.problems[ws.active_index]]["title"]
    session.turns = [*session.turns, {"who": "interviewer", "kind": "chat", "text": f"The next problem is {next_title}. The constraints are: {PROBLEMS[ws.problems[ws.active_index]]['constraints']} Take a moment to read it, then talk me through your approach.", "at": utcnow().isoformat()}]
    db.commit()
    return coding.public(db, ws)
