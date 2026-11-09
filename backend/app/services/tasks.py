"""Runs AI tasks in the background and records progress in the database."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import delete, select, update

from ..db import SessionLocal
from ..models import AiTask, Job, Resume
from . import context, entitlements
from . import ats as ats_service
from .tailor import TailorOptions, tailor_resume

_running: dict[str, asyncio.Task] = {}
_slots = asyncio.Semaphore(4)  # per instance; keeps a burst of clicks from hammering the provider


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _detail(e: HTTPException) -> str:
    d = e.detail
    if isinstance(d, dict):
        return str((d.get("errors") or ["Request failed"])[0])
    return str(d)


def create(kind: str, resume_id: Optional[int], payload: dict[str, Any], label: str, user_id: int, tenant_id: int) -> str:
    tid = uuid.uuid4().hex
    with SessionLocal() as db:
        db.add(AiTask(id=tid, user_id=user_id, tenant_id=tenant_id, kind=kind, status="queued", resume_id=resume_id, payload=payload, label=label[:300]))
        db.commit()
    _running[tid] = asyncio.create_task(_run(tid))
    return tid


def _refund_if_charged(tid: str) -> None:
    """The user was charged when the task was created; if we failed to deliver, give the unit back (once)."""
    with SessionLocal() as db:
        t = db.get(AiTask, tid)
        if t and (t.payload or {}).get("_charged") and not (t.payload or {}).get("_refunded"):
            entitlements.refund(db, t.tenant_id, t.user_id, "tailor" if t.kind == "tailor" else "ats_check")
            t.payload = {**(t.payload or {}), "_refunded": 1}
            db.commit()


def _set(tid: str, **vals: Any) -> None:
    with SessionLocal() as db:
        db.execute(update(AiTask).where(AiTask.id == tid).values(**vals))
        db.commit()


async def _run(tid: str) -> None:
    try:
        async with _slots:
            with SessionLocal() as db:
                t = db.get(AiTask, tid)
                if not t or t.status == "cancelled":
                    return
                kind, resume_id, p = t.kind, t.resume_id, dict(t.payload or {})
                context.current_user_id.set(t.user_id)  # the OpenAI key and preferences are looked up as this user
                context.current_purpose.set(t.kind)
                owned = db.get(Resume, resume_id) if resume_id else None
                master = owned.latex if owned and owned.user_id == t.user_id else ""
                if p.get("job_id") and not p.get("job_description"):
                    job = db.get(Job, int(p["job_id"]))
                    if job:
                        p.update(job_description=job.description, company=p.get("company") or job.company, job_title=p.get("job_title") or job.title)
                _set(tid, status="running", progress="Starting")
                latex = p.get("latex") or master
                if kind == "tailor":
                    from ..routers.preferences import load_prefs

                    pr = load_prefs(db, t.user_id)
                    base = dict(strict_terms=pr.ai_strictness == "strict", temperature=pr.ai_creativity,
                                max_attempts=pr.ai_max_attempts, default_instructions=pr.ai_default_instructions)
                    opts = TailorOptions(**{**base, **(p.get("options") or {})})
                    res = await asyncio.wait_for(tailor_resume(
                        db, latex, p.get("job_description", ""), p.get("company"), p.get("job_title"), p.get("instructions"), opts,
                        on_progress=lambda m: _set(tid, progress=m[:200]),
                    ), timeout=420)
                    out = res.model_dump()
                elif kind == "ats":
                    _set(tid, progress="Compiling and reading your PDF")
                    out = await ats_service.analyze(db, latex, p.get("job_description", ""), p.get("company"), p.get("job_title"))
                else:
                    raise HTTPException(400, f"unknown task kind {kind}")
        _set(tid, status="done", progress="Done", result=out, finished_at=_now())
    except asyncio.TimeoutError:
        _refund_if_charged(tid)
        _set(tid, status="error", error="This took longer than 7 minutes and was stopped. Try again.", progress="Failed", finished_at=_now())
    except asyncio.CancelledError:
        _refund_if_charged(tid)
        _set(tid, status="cancelled", progress="Cancelled", finished_at=_now())
        raise
    except HTTPException as e:
        _refund_if_charged(tid)
        _set(tid, status="error", error=_detail(e), progress="Failed", finished_at=_now())
    except Exception as e:  # never let a task die silently
        _refund_if_charged(tid)
        _set(tid, status="error", error=f"Unexpected error: {type(e).__name__}", progress="Failed", finished_at=_now())
    finally:
        _running.pop(tid, None)


def cancel(tid: str) -> bool:
    t = _running.get(tid)
    if t:
        t.cancel()
        return True
    return False


def recover_after_restart(keep_days: int = 7) -> None:
    """Tasks that were running when the process died can never finish: mark them failed instead of spinning forever."""
    with SessionLocal() as db:
        db.execute(update(AiTask).where(AiTask.status.in_(["queued", "running"])).values(
            status="error", error="Interrupted by a server restart. Run it again.", progress="Failed", finished_at=_now()))
        db.execute(delete(AiTask).where(AiTask.created_at < _now() - timedelta(days=keep_days)))
        db.commit()
