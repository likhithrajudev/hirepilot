"""Contests: timed rounds on the problem library with a live leaderboard. Ranking is ICPC-style: most problems solved, then least penalty."""
import math
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, platform_admin
from ..models import Contest, ContestRegistration, ContestSubmission, User
from ..services import coding, ratelimit
from ..services.coding_problems import PROBLEMS
from .practice import POINTS, RunBody

router = APIRouter(prefix="/contests", tags=["contests"])


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ends(c: Contest) -> datetime:
    return _aware(c.starts_at) + timedelta(minutes=c.duration_min)


def _state(c: Contest, now: datetime) -> str:
    return "upcoming" if now < _aware(c.starts_at) else "live" if now < _ends(c) else "ended"


def _name(u: Optional[User]) -> str:
    parts = ((u.name if u and u.name else (u.email.split("@")[0] if u else "Someone"))).split()
    return parts[0] + (f" {parts[-1][0]}." if len(parts) > 1 else "")


def _view(db: Session, c: Contest, user: User, now: datetime) -> dict:
    regs = db.scalar(select(func.count()).select_from(ContestRegistration).where(ContestRegistration.contest_id == c.id)) or 0
    mine = db.scalar(select(ContestRegistration.id).where(ContestRegistration.contest_id == c.id, ContestRegistration.user_id == user.id)) is not None
    return {"id": c.id, "name": c.name, "kind": c.kind, "starts_at": _aware(c.starts_at), "ends_at": _ends(c), "duration_min": c.duration_min, "penalty_min": c.penalty_min,
            "state": _state(c, now), "registered_count": regs, "registered": mine, "problem_count": len(c.problem_ids or [])}


def _get(db: Session, cid: int) -> Contest:
    c = db.get(Contest, cid)
    if not c:
        raise HTTPException(404, "Contest not found")
    return c


@router.get("")
def contests(db: Session = Depends(get_db), user: User = Depends(current_user)):
    now = datetime.now(timezone.utc)
    rows = [_view(db, c, user, now) for c in db.scalars(select(Contest).order_by(Contest.starts_at)).all()]
    return {"live": [r for r in rows if r["state"] == "live"], "upcoming": [r for r in rows if r["state"] == "upcoming"],
            "past": [r for r in reversed(rows) if r["state"] == "ended"][:10], "can_create": bool(user.is_platform_admin)}


class ContestBody(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    kind: Literal["weekly", "themed", "college"] = "weekly"
    starts_at: datetime
    duration_min: int = Field(default=90, ge=10, le=300)
    penalty_min: int = Field(default=5, ge=0, le=60)
    problem_ids: list[str] = Field(min_length=1, max_length=8)


@router.post("", status_code=201)
def create(body: ContestBody, db: Session = Depends(get_db), user: User = Depends(platform_admin)):
    if any(p not in PROBLEMS for p in body.problem_ids) or len(set(body.problem_ids)) != len(body.problem_ids):
        raise HTTPException(422, "Pick distinct problems from the library")
    c = Contest(name=body.name.strip(), kind=body.kind, starts_at=_aware(body.starts_at), duration_min=body.duration_min, penalty_min=body.penalty_min,
                problem_ids=body.problem_ids, created_by=user.id)
    db.add(c); db.commit()
    return _view(db, c, user, datetime.now(timezone.utc))


@router.post("/{cid}/register", status_code=204)
def register(cid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _get(db, cid)
    if _state(c, datetime.now(timezone.utc)) == "ended":
        raise HTTPException(409, "This contest has ended")
    if not db.scalar(select(ContestRegistration.id).where(ContestRegistration.contest_id == cid, ContestRegistration.user_id == user.id)):
        db.add(ContestRegistration(contest_id=cid, user_id=user.id)); db.commit()


@router.delete("/{cid}/register", status_code=204)
def unregister(cid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _get(db, cid)
    if _state(c, datetime.now(timezone.utc)) != "upcoming":
        raise HTTPException(409, "You can only leave a contest before it starts")
    reg = db.scalar(select(ContestRegistration).where(ContestRegistration.contest_id == cid, ContestRegistration.user_id == user.id))
    if reg:
        db.delete(reg); db.commit()


def _mine(db: Session, cid: int, uid: int) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for s in db.scalars(select(ContestSubmission).where(ContestSubmission.contest_id == cid, ContestSubmission.user_id == uid).order_by(ContestSubmission.created_at)).all():
        o = out.setdefault(s.problem_id, {"solved": False, "wrong": 0})
        if s.status == "accepted":
            o["solved"] = True
        elif not o["solved"]:
            o["wrong"] += 1
    return out


@router.get("/{cid}")
def detail(cid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _get(db, cid)
    now = datetime.now(timezone.utc)
    v = _view(db, c, user, now)
    if v["state"] == "upcoming":
        return {**v, "problems": []}   # the problems stay hidden until the start
    mine = _mine(db, cid, user.id)
    return {**v, "problems": [{"id": pid, "title": PROBLEMS[pid]["title"], "difficulty": PROBLEMS[pid]["difficulty"], "points": POINTS[PROBLEMS[pid]["difficulty"]],
                               "status": "solved" if mine.get(pid, {}).get("solved") else "tried" if mine.get(pid) else ""} for pid in c.problem_ids]}


@router.post("/{cid}/problems/{pid}/run")
async def run(cid: int, pid: str, body: RunBody, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _get(db, cid)
    now = datetime.now(timezone.utc)
    if pid not in (c.problem_ids or []):
        raise HTTPException(404, "That problem is not part of this contest")
    if _state(c, now) != "live":
        raise HTTPException(409, "This contest is not running")
    allowed, retry = ratelimit.hit(f"contest-run:{user.id}", 10, 60)
    if not allowed:
        raise HTTPException(429, "Run limit reached. Wait a moment before running again.", headers={"Retry-After": str(retry)})
    if not body.source.strip():
        raise HTTPException(422, "Write some code before running")
    if not db.scalar(select(ContestRegistration.id).where(ContestRegistration.contest_id == cid, ContestRegistration.user_id == user.id)):
        db.add(ContestRegistration(contest_id=cid, user_id=user.id)); db.commit()   # entering a live contest registers you
    cases = [x for x in PROBLEMS[pid]["cases"] if body.mode == "submit" or not x["hidden"]]
    result = await coding.execute(body.language, body.source, cases)
    if body.mode == "submit" and not _mine(db, cid, user.id).get(pid, {}).get("solved"):
        minute = (now - _aware(c.starts_at)).total_seconds() / 60
        db.add(ContestSubmission(contest_id=cid, user_id=user.id, problem_id=pid, language=body.language, status=result["status"], passed=result.get("passed", 0), total=result.get("total", len(cases)), minute=round(minute, 2)))
        db.commit()
    return result


@router.get("/{cid}/standings")
def standings(cid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _get(db, cid)
    now = datetime.now(timezone.utc)
    if _state(c, now) == "upcoming":
        return {"problems": [], "rows": []}
    per: dict[int, dict[str, dict]] = {}
    for s in db.scalars(select(ContestSubmission).where(ContestSubmission.contest_id == cid).order_by(ContestSubmission.created_at)).all():
        o = per.setdefault(s.user_id, {}).setdefault(s.problem_id, {"wrong": 0, "ac": None})
        if o["ac"] is not None:
            continue
        if s.status == "accepted":
            o["ac"] = s.minute
        else:
            o["wrong"] += 1
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(list(per) or [0]))).all()}
    rows = []
    for uid, probs in per.items():
        score = sum(POINTS[PROBLEMS[p]["difficulty"]] for p, o in probs.items() if o["ac"] is not None)
        penalty = sum(math.ceil(o["ac"]) + o["wrong"] * c.penalty_min for o in probs.values() if o["ac"] is not None)
        cells = []
        for pid in c.problem_ids:
            o = probs.get(pid)
            cells.append(None if not o else {"minute": math.ceil(o["ac"]), "wrong": o["wrong"]} if o["ac"] is not None else {"minute": None, "wrong": o["wrong"]})
        rows.append({"user_id": uid, "name": _name(users.get(uid)), "you": uid == user.id, "score": score, "penalty": penalty, "cells": cells})
    rows.sort(key=lambda r: (-r["score"], r["penalty"], r["name"]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
        r.pop("user_id")
    return {"problems": [{"id": p, "label": chr(65 + i)} for i, p in enumerate(c.problem_ids)], "rows": rows[:100]}
