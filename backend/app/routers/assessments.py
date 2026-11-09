"""Online assessments a hiring team attaches to a role: multiple-choice questions plus coding problems from the library, auto-graded and timed."""
import statistics
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Assessment, AssessmentAttempt, TeamCandidate, TeamJob, User
from ..services import coding, ratelimit
from ..services.coding_problems import LANGUAGES, PROBLEMS, STARTERS, public_problem
from .practice import RunBody

router = APIRouter(prefix="/assessments", tags=["assessments"])
GRACE = timedelta(seconds=45)   # network slack when saving the last answers


class MC(BaseModel):
    kind: Literal["mc"]
    text: str = Field(min_length=5, max_length=600)
    code: str = Field(default="", max_length=2000)
    options: list[str] = Field(min_length=2, max_length=6)
    correct: int
    points: int = Field(default=5, ge=1, le=50)

    @model_validator(mode="after")
    def _ok(self):
        if not 0 <= self.correct < len(self.options) or any(not o.strip() or len(o) > 300 for o in self.options):
            raise ValueError("Each option needs text and the correct answer must be one of them")
        return self


class ProblemQ(BaseModel):
    kind: Literal["problem"]
    problem_id: str
    points: int = Field(default=15, ge=1, le=100)

    @model_validator(mode="after")
    def _ok(self):
        if self.problem_id not in PROBLEMS:
            raise ValueError("Pick a problem from the library")
        return self


Question = Annotated[Union[MC, ProblemQ], Field(discriminator="kind")]


class AssessmentBody(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    duration_min: int = Field(default=60, ge=10, le=180)
    cutoff: int = Field(default=65, ge=1, le=100)
    questions: list[Question] = Field(min_length=1, max_length=30)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _own(db: Session, user: User, aid: int) -> Assessment:
    a = db.get(Assessment, aid)
    if not a or a.tenant_id != user.tenant_id:
        raise HTTPException(404, "Assessment not found")
    return a


@router.get("")
def listing(db: Session = Depends(get_db), user: User = Depends(current_user)):
    out = []
    for a in db.scalars(select(Assessment).where(Assessment.tenant_id == user.tenant_id).order_by(Assessment.created_at.desc())).all():
        at = db.scalars(select(AssessmentAttempt).where(AssessmentAttempt.assessment_id == a.id)).all()
        out.append({"id": a.id, "title": a.title, "duration_min": a.duration_min, "cutoff": a.cutoff, "questions": len(a.questions or []), "started": len(at), "completed": sum(x.status == "done" for x in at)})
    return out


@router.post("", status_code=201)
def create(body: AssessmentBody, db: Session = Depends(get_db), user: User = Depends(current_user)):
    a = Assessment(tenant_id=user.tenant_id, created_by=user.id, title=body.title.strip(), duration_min=body.duration_min, cutoff=body.cutoff, questions=[q.model_dump() for q in body.questions])
    db.add(a); db.commit()
    return {"id": a.id}


@router.get("/problems")
def problem_choices(user: User = Depends(current_user)):
    return [{"id": pid, "title": p["title"], "difficulty": p["difficulty"]} for pid, p in PROBLEMS.items()]


@router.get("/{aid}")
def get(aid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    a = _own(db, user, aid)
    return {"id": a.id, "title": a.title, "duration_min": a.duration_min, "cutoff": a.cutoff, "questions": a.questions or []}


@router.put("/{aid}")
def update(aid: int, body: AssessmentBody, db: Session = Depends(get_db), user: User = Depends(current_user)):
    a = _own(db, user, aid)
    if db.scalar(select(AssessmentAttempt.id).where(AssessmentAttempt.assessment_id == aid).limit(1)):
        raise HTTPException(409, "Candidates have already started this assessment, so its questions can no longer change. Create a new one instead.")
    a.title, a.duration_min, a.cutoff, a.questions = body.title.strip(), body.duration_min, body.cutoff, [q.model_dump() for q in body.questions]
    db.commit()
    return {"ok": True}


def _label(q: dict) -> str:
    return PROBLEMS[q["problem_id"]]["title"] if q["kind"] == "problem" else q["text"][:60]


@router.get("/{aid}/results")
def results(aid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    a = _own(db, user, aid)
    attempts = db.scalars(select(AssessmentAttempt).where(AssessmentAttempt.assessment_id == aid)).all()
    cands = {c.id: c for c in db.scalars(select(TeamCandidate).where(TeamCandidate.id.in_([x.candidate_id for x in attempts] or [0]))).all()}
    invited = db.scalar(select(__import__("sqlalchemy").func.count()).select_from(TeamCandidate).where(TeamCandidate.job_id.in_(select(TeamJob.id).where(TeamJob.assessment_id == aid)))) or 0
    done = [x for x in attempts if x.status == "done"]
    scores = [x.score or 0 for x in done]
    hist = [0] * 10
    for s in scores:
        hist[min(9, s // 10)] += 1
    rows = []
    for x in sorted(attempts, key=lambda x: (x.status != "done", -(x.score or 0))):
        c = cands.get(x.candidate_id)
        secs = int((_aware(x.finished_at) - _aware(x.started_at)).total_seconds()) if x.finished_at else None
        rows.append({"candidate_id": x.candidate_id, "name": c.name if c else "Candidate", "school": c.school if c else "", "score": x.score, "seconds": secs,
                     "status": "In progress" if x.status != "done" else "Above cut-off" if (x.score or 0) >= a.cutoff else "Below cut-off"})
    hardest = []
    for i, q in enumerate(a.questions or []):
        got = [(p["earned"] / p["points"]) for x in done for p in (x.per_question or []) if p["index"] == i and p["points"]]
        if got:
            hardest.append({"index": i + 1, "label": _label(q), "percent": round(100 * sum(got) / len(got))})
    hardest.sort(key=lambda h: h["percent"])
    return {"assessment": {"id": a.id, "title": a.title, "duration_min": a.duration_min, "cutoff": a.cutoff, "questions": len(a.questions or [])},
            "summary": {"invited": invited, "started": len(attempts), "completed": len(done), "median": round(statistics.median(scores)) if scores else None, "above_cutoff": sum(s >= a.cutoff for s in scores)},
            "rows": rows, "histogram": hist, "hardest": hardest[:5]}


# ───────── the candidate's side ─────────
def _attempt(db: Session, user: User, aid: int) -> tuple[AssessmentAttempt, Assessment]:
    at = db.get(AssessmentAttempt, aid)
    if not at or at.user_id != user.id:
        raise HTTPException(404, "Assessment not found")
    return at, db.get(Assessment, at.assessment_id)


def _deadline(at: AssessmentAttempt, a: Assessment) -> datetime:
    return _aware(at.started_at) + timedelta(minutes=a.duration_min)


def _grade(db: Session, at: AssessmentAttempt, a: Assessment) -> None:
    if at.status == "done":
        return
    per, earned, total = [], 0.0, 0
    for i, q in enumerate(a.questions or []):
        ans = (at.answers or {}).get(str(i))
        if q["kind"] == "mc":
            ok = isinstance(ans, int) and ans == q["correct"]
            e = q["points"] if ok else 0
        else:
            ratio = (ans["passed"] / ans["total"]) if isinstance(ans, dict) and ans.get("total") else 0
            e = round(q["points"] * ratio, 2)
        earned += e; total += q["points"]
        per.append({"index": i, "kind": q["kind"], "points": q["points"], "earned": e})
    at.score = round(100 * earned / total) if total else 0
    at.per_question = per; at.status = "done"; at.finished_at = datetime.now(timezone.utc)
    db.commit()


def _live(db: Session, at: AssessmentAttempt, a: Assessment) -> None:
    """An attempt past its time is graded as it stands; nothing more can be saved."""
    if at.status == "active" and datetime.now(timezone.utc) > _deadline(at, a) + GRACE:
        _grade(db, at, a)
    if at.status != "active":
        raise HTTPException(409, "This assessment has ended")


@router.get("/attempts/{aid}")
def attempt(aid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    at, a = _attempt(db, user, aid)
    if at.status == "active" and datetime.now(timezone.utc) > _deadline(at, a) + GRACE:
        _grade(db, at, a)
    qs = []
    for i, q in enumerate(a.questions or []):
        item = {"index": i, "kind": q["kind"], "points": q["points"]}
        if q["kind"] == "mc":
            item.update(text=q["text"], code=q.get("code", ""), options=q["options"])
        else:
            item["problem"] = {**public_problem(q["problem_id"]), "languages": LANGUAGES, "starters": STARTERS}
        qs.append(item)
    return {"id": at.id, "title": a.title, "status": at.status, "duration_min": a.duration_min, "ends_at": _deadline(at, a), "seconds_left": max(0, int((_deadline(at, a) - datetime.now(timezone.utc)).total_seconds())),
            "questions": qs, "answers": at.answers or {}}


class AnswerBody(BaseModel):
    index: int = Field(ge=0)
    choice: int = Field(ge=0, le=5)


@router.put("/attempts/{aid}/answers")
def answer(aid: int, body: AnswerBody, db: Session = Depends(get_db), user: User = Depends(current_user)):
    at, a = _attempt(db, user, aid)
    _live(db, at, a)
    qs = a.questions or []
    if body.index >= len(qs) or qs[body.index]["kind"] != "mc" or body.choice >= len(qs[body.index]["options"]):
        raise HTTPException(422, "Not a valid answer for that question")
    at.answers = {**(at.answers or {}), str(body.index): body.choice}
    db.commit()
    return {"saved": True}


@router.post("/attempts/{aid}/problems/{index}/run")
async def run(aid: int, index: int, body: RunBody, db: Session = Depends(get_db), user: User = Depends(current_user)):
    at, a = _attempt(db, user, aid)
    _live(db, at, a)
    qs = a.questions or []
    if not 0 <= index < len(qs) or qs[index]["kind"] != "problem":
        raise HTTPException(404, "That question has no code to run")
    allowed, retry = ratelimit.hit(f"assess-run:{user.id}", 10, 60)
    if not allowed:
        raise HTTPException(429, "Run limit reached. Wait a moment before running again.", headers={"Retry-After": str(retry)})
    if not body.source.strip():
        raise HTTPException(422, "Write some code before running")
    cases = [c for c in PROBLEMS[qs[index]["problem_id"]]["cases"] if body.mode == "submit" or not c["hidden"]]
    result = await coding.execute(body.language, body.source, cases)
    if body.mode == "submit":
        prev = (at.answers or {}).get(str(index))
        new = {"passed": result.get("passed", 0), "total": result.get("total", len(cases)), "language": body.language}
        if not isinstance(prev, dict) or new["passed"] / max(1, new["total"]) >= prev["passed"] / max(1, prev["total"]):   # the best attempt counts
            at.answers = {**(at.answers or {}), str(index): new}
            db.commit()
    return result


@router.post("/attempts/{aid}/finish")
def finish(aid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    at, a = _attempt(db, user, aid)
    _grade(db, at, a)
    return {"status": "done"}
