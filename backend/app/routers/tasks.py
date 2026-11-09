from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import AiTask, Resume, User
from ..services import entitlements, tasks as task_service

router = APIRouter(prefix="/tasks", tags=["tasks"])


class TaskCreate(BaseModel):
    kind: str = Field(pattern="^(tailor|ats)$")
    resume_id: int
    payload: dict[str, Any] = Field(default_factory=dict)
    label: str = ""


def _summary(t: AiTask) -> dict[str, Any]:
    return {
        "id": t.id, "kind": t.kind, "status": t.status, "progress": t.progress, "resume_id": t.resume_id,
        "label": t.label, "error": t.error, "created_at": t.created_at, "finished_at": t.finished_at,
        "has_result": t.result is not None,
    }


@router.post("", status_code=202)
async def create_task(body: TaskCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    owned = db.get(Resume, body.resume_id)
    if not owned or owned.user_id != user.id:
        raise HTTPException(404, "Resume not found")
    if body.kind == "ats" and len((body.payload.get("job_description") or "").strip()) < 20:
        raise HTTPException(422, "Paste a job description first")
    p = dict(body.payload)
    feature = "tailor" if body.kind == "tailor" else "ats_check"
    p["_charged"] = 0
    if entitlements.metered(db, feature):
        entitlements.charge(db, user, feature)  # raises 402 with an upgrade prompt when the allowance is spent
        p["_charged"] = 1  # remembered so a failed or cancelled job can give it back
    label = body.label or " · ".join(x for x in (p.get("company"), p.get("job_title")) if x) or ("Job description" if p.get("job_description") else "")
    return {"id": task_service.create(body.kind, body.resume_id, p, label, user.id, user.tenant_id), "status": "queued"}


@router.get("")
def list_tasks(
    resume_id: Optional[int] = None,
    kind: Optional[str] = Query(None, pattern="^(tailor|ats)$"),
    active: bool = False,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    stmt = select(AiTask).where(AiTask.user_id == user.id)
    if resume_id is not None:
        stmt = stmt.where(AiTask.resume_id == resume_id)
    if kind:
        stmt = stmt.where(AiTask.kind == kind)
    if active:
        stmt = stmt.where(AiTask.status.in_(["queued", "running"]))
    return [_summary(t) for t in db.scalars(stmt.order_by(AiTask.created_at.desc()).limit(limit)).all()]


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = db.get(AiTask, task_id)
    if not t or t.user_id != user.id:
        raise HTTPException(404, "Task not found")
    payload = {k: v for k, v in (t.payload or {}).items() if k != "latex"}  # the resume text can be huge and is not needed
    return {**_summary(t), "result": t.result, "payload": payload}


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Cancels a running task, or removes a finished one (e.g. after accepting or discarding its result)."""
    t = db.get(AiTask, task_id)
    if not t or t.user_id != user.id:
        return
    if t.status in ("queued", "running") and task_service.cancel(task_id):
        return
    db.delete(t)
    db.commit()
