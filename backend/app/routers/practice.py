"""The problem library: practise the same reviewed coding tasks the interviews use, on your own, with run and submit."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import PracticeSubmission, User
from ..services import coding, ratelimit
from ..services.coding_problems import LANGUAGES, PROBLEMS, STARTERS, public_problem

router = APIRouter(prefix="/practice", tags=["practice"])

TOPICS = {"pairs": "Hashing", "brackets": "Stacks", "merge_sorted": "Two pointers", "subarray": "Dynamic programming", "intervals": "Sorting",
          "unique": "Sliding window", "window": "Sliding window", "sliding": "Monotonic deque", "path": "Graphs · Dijkstra"}
POINTS = {"easy": 10, "medium": 30, "hard": 60}


def _status(db: Session, user: User) -> dict[str, dict]:
    rows = db.scalars(select(PracticeSubmission).where(PracticeSubmission.user_id == user.id)).all()
    out: dict[str, dict] = {}
    for r in rows:
        s = out.setdefault(r.problem_id, {"solved": False, "tried": 0})
        s["tried"] += 1
        if r.mode == "submit" and r.status == "accepted":
            s["solved"] = True
    return out


def _row(pid: str, st: dict) -> dict:
    p = PROBLEMS[pid]
    return {"id": pid, "title": p["title"], "difficulty": p["difficulty"], "topic": TOPICS.get(pid, "General"), "points": POINTS.get(p["difficulty"], 10),
            "case_count": len(p["cases"]), "status": "solved" if st.get("solved") else "tried" if st.get("tried") else ""}


@router.get("/problems")
def problems(db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _status(db, user)
    rows = [_row(pid, st.get(pid, {})) for pid in PROBLEMS]
    by = {d: {"solved": sum(r["status"] == "solved" for r in rows if r["difficulty"] == d), "total": sum(r["difficulty"] == d for r in rows)} for d in ("easy", "medium", "hard")}
    return {"problems": rows, "progress": {"solved": sum(v["solved"] for v in by.values()), "total": len(rows), "by_difficulty": by}}


@router.get("/problems/{pid}")
def problem(pid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if pid not in PROBLEMS:
        raise HTTPException(404, "Problem not found")
    st = _status(db, user).get(pid, {})
    attempts = db.scalars(select(PracticeSubmission).where(PracticeSubmission.user_id == user.id, PracticeSubmission.problem_id == pid)
                          .order_by(PracticeSubmission.created_at.desc()).limit(10)).all()
    return {**public_problem(pid), **_row(pid, st), "languages": LANGUAGES, "starters": STARTERS,
            "attempts": [{"created_at": a.created_at, "language": a.language, "mode": a.mode, "status": a.status, "passed": a.passed, "total": a.total} for a in attempts]}


class RunBody(BaseModel):
    language: Literal["python", "javascript", "cpp", "java"]
    source: str = Field(min_length=1, max_length=50000)
    mode: Literal["examples", "submit"] = "examples"


@router.post("/problems/{pid}/run")
async def run(pid: str, body: RunBody, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if pid not in PROBLEMS:
        raise HTTPException(404, "Problem not found")
    allowed, retry = ratelimit.hit(f"practice-run:{user.id}", 10, 60)
    if not allowed:
        raise HTTPException(429, "Run limit reached. Wait a moment before running again.", headers={"Retry-After": str(retry)})
    if not body.source.strip():
        raise HTTPException(422, "Write some code before running")
    cases = [c for c in PROBLEMS[pid]["cases"] if body.mode == "submit" or not c["hidden"]]
    result = await coding.execute(body.language, body.source, cases)   # raises 503 when the isolated runner is unavailable: nothing is recorded then
    db.add(PracticeSubmission(user_id=user.id, problem_id=pid, language=body.language, mode=body.mode, status=result["status"], passed=result.get("passed", 0), total=result.get("total", len(cases))))
    db.commit()
    return result
