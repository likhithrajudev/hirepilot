import asyncio
import dataclasses
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from sqlalchemy import and_, func, or_, select
from pydantic import TypeAdapter
from sqlalchemy.orm import Session, defer

from ..config import settings
from ..db import SessionLocal, get_db
from ..deps import current_user
from ..models import Job, Resume, User, UserJob
from ..schemas import JobDetail, JobOut, JobPatch, RefreshRequest, ScoreRequest
from ..services import cache, context, entitlements, geo, hiring
from ..services import jobs as jobs_service
from ..services.latex import latex_to_text
from ..services.llm import json_chat

router = APIRouter(prefix="/jobs", tags=["jobs"])


_JOBS_OUT = TypeAdapter(list[JobOut])


def _view(job: Job, uj: Optional[UserJob]) -> dict:
    """A catalog job as this user sees it: shared fields from the job, status and review from their own overlay."""
    return {
        "id": job.id, "source": job.source, "company": job.company, "title": job.title, "location": job.location, "url": job.url,
        "posted_at": job.posted_at, "level_tag": job.level_tag, "fetched_at": job.fetched_at,
        "status": uj.status if uj else "new", "score": uj.score if uj else None,
        "score_reason": hiring.scrub(uj.score_reason) or None if uj else None,  # scrubbed on read: old rows may still mention ids
        "scored_resume_id": uj.scored_resume_id if uj else None, "score_detail": uj.score_detail if uj else None,
    }


def _overlay(uid: int):
    return and_(UserJob.job_id == Job.id, UserJob.user_id == uid)


def _upsert_state(db: Session, uid: int, job_id: int) -> UserJob:
    uj = db.get(UserJob, (uid, job_id))
    if uj is None:
        uj = UserJob(user_id=uid, job_id=job_id, status="new")
        db.add(uj)
    return uj


def _cached_response(request: Request, ns: str, params: dict, ttl: int, build) -> Response:
    body, etag, state = cache.cached_json(ns, params, ttl, build)
    # private: the list carries per-user status/score, so shared caches (CDN) must not store it yet.
    headers = {"ETag": etag, "Cache-Control": "private, max-age=5, must-revalidate", "X-Cache": state}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("", response_model=list[JobOut])
def list_jobs(
    request: Request,
    q: Optional[str] = None,
    company: Optional[str] = None,
    location: Optional[str] = None,
    level: Optional[str] = Query(None, pattern="^(intern|new_grad|junior|other)$"),
    status: Optional[str] = Query(None, pattern="^(new|saved|applied|ignored)$"),
    hide_ignored: bool = True,
    exclude: Optional[str] = Query(None, description="comma-separated company names to hide"),
    min_score: Optional[int] = Query(None, ge=0, le=100),
    hide_below: Optional[int] = Query(None, ge=0, le=100, description="hide SCORED jobs below this; unscored jobs stay visible"),
    sort: str = Query("score", pattern="^(score|recent|company)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    uid = user.id
    params = dict(q=q, company=company, location=location, level=level, status=status, hide_ignored=hide_ignored, exclude=exclude, hide_below=hide_below,
                  min_score=min_score, sort=sort, limit=limit, offset=offset, catalog=cache.version("catalog"))

    def build() -> bytes:
        # defer(description): the list never shows it, and loading it cost ~35 of ~53 ms per query.
        stmt = select(Job, UserJob).options(defer(Job.description)).outerjoin(UserJob, _overlay(uid))
        state = func.coalesce(UserJob.status, "new")
        if q:
            like = f"%{q}%"
            stmt = stmt.where(or_(Job.title.ilike(like), Job.company.ilike(like), Job.description.ilike(like)))
        if company:
            stmt = stmt.where(Job.company == company)
        blocked = [c.strip() for c in (exclude or "").split(",") if c.strip()]
        if blocked:
            stmt = stmt.where(Job.company.not_in(blocked))
        if location:
            terms = [t.strip() for t in location.split(",") if t.strip()]
            alias_terms = {a for t in terms for a in geo.aliases(t)} if terms else set()
            if alias_terms:
                stmt = stmt.where(or_(*[Job.location.ilike(f"%{a}%") for a in sorted(alias_terms)]))
        if level:
            stmt = stmt.where(Job.level_tag == level)
        if status:
            stmt = stmt.where(state == status)
        elif hide_ignored:
            stmt = stmt.where(state != "ignored")
        if min_score is not None:
            stmt = stmt.where(UserJob.score >= min_score)
        if hide_below:
            stmt = stmt.where(or_(UserJob.score.is_(None), UserJob.score >= hide_below))
        if sort == "score":
            stmt = stmt.order_by(UserJob.score.desc().nulls_last(), Job.posted_at.desc().nulls_last())
        elif sort == "recent":
            stmt = stmt.order_by(Job.posted_at.desc().nulls_last(), Job.id.desc())
        else:
            stmt = stmt.order_by(Job.company, Job.title)
        rows = db.execute(stmt.limit(limit).offset(offset)).all()
        return _JOBS_OUT.dump_json(_JOBS_OUT.validate_python([_view(j, uj) for j, uj in rows]))

    return _cached_response(request, f"jobs:{uid}", params, settings.cache_ttl_seconds, build)


def _company_rows(db: Session) -> list[dict]:
    counts = dict(db.execute(select(Job.company, func.count()).group_by(Job.company)).all())
    return [
        {"name": c["name"], "ats": c["ats"], "domain": c.get("domain"), "logo": not c.get("no_logo", False),
         "careers_url": jobs_service.careers_url(c), "jobs": counts.get(c["name"], 0)}
        for c in jobs_service.load_companies()
    ]


@router.get("/companies/index")
def companies_index(request: Request):
    """Name -> domain map used to draw logos everywhere. Static, tiny, and safe to cache for a long time."""
    def build() -> bytes:
        import json

        return json.dumps([{"name": c["name"], "domain": c.get("domain"), "logo": not c.get("no_logo", False)} for c in jobs_service.load_companies()]).encode()

    resp = _cached_response(request, "static", {"view": "company-index"}, 3600, build)
    resp.headers["Cache-Control"] = "public, max-age=3600"  # contains no user data, so shared caches may keep it
    return resp


@router.get("/companies")
def companies(
    request: Request,
    q: str = "",
    ats: str = "",
    sort: str = Query("name", pattern="^(name|jobs)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Paginated company directory. Sources (ATS) are returned unfiltered so the filter chips stay stable."""
    params = {"view": "companies", "q": q, "ats": ats, "sort": sort, "page": page, "page_size": page_size}

    def build() -> bytes:
        import json
        from collections import Counter

        rows = _company_rows(db)
        sources = sorted(Counter(c["ats"] for c in rows).items(), key=lambda kv: (-kv[1], kv[0]))
        ql = q.strip().lower()
        rows = [c for c in rows if (not ql or ql in c["name"].lower()) and (not ats or c["ats"] == ats)]
        rows.sort(key=(lambda c: (-c["jobs"], c["name"].lower())) if sort == "jobs" else (lambda c: c["name"].lower()))
        total = len(rows)
        pages = max(1, -(-total // page_size))
        start = (min(page, pages) - 1) * page_size
        return json.dumps({"items": rows[start : start + page_size], "total": total, "page": min(page, pages), "page_size": page_size,
                           "pages": pages, "sources": [{"ats": a, "count": n} for a, n in sources]}).encode()

    return _cached_response(request, "catalog", params, max(settings.cache_ttl_seconds, 60), build)


@router.get("/cache/stats")
def cache_stats():
    return {"backend": settings.cache_backend, **cache.stats}


@router.post("/refresh", status_code=202)
async def refresh(body: RefreshRequest, background: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if jobs_service.status.running:
        raise HTTPException(409, "A refresh is already running")
    entitlements.charge(db, user, "scans")
    jobs_service.status.running = True  # claim immediately so a second click gets 409
    background.add_task(
        jobs_service.refresh_jobs, SessionLocal, body.roles, body.locations, body.companies,
        body.include_internships, body.include_all_levels,
    )
    return {"started": True}


@router.get("/refresh/status")
def refresh_status():
    return dataclasses.asdict(jobs_service.status)


@router.post("/score")
async def score(body: ScoreRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    resume = db.get(Resume, body.resume_id)
    if not resume or resume.user_id != user.id:
        raise HTTPException(404, "Resume not found")
    uid = user.id
    context.current_purpose.set("review")
    if body.job_ids:
        jobs = db.scalars(select(Job).where(Job.id.in_(body.job_ids))).all()
    else:
        jobs = db.scalars(
            select(Job).outerjoin(UserJob, _overlay(uid))
            .where(UserJob.score.is_(None), Job.level_tag != "other", func.coalesce(UserJob.status, "new") != "ignored")
            .order_by(Job.posted_at.desc().nulls_last())
            .limit(body.limit)
        ).all()
    jobs = list(jobs)[: body.limit]
    if not jobs:
        return {"scored": 0}
    charged = entitlements.metered(db, "review")
    granted = entitlements.charge(db, user, "review", len(jobs), partial=True)  # a short allowance reviews what it can
    jobs = jobs[:granted]

    resume_text = latex_to_text(resume.latex)[:7000]
    sem = asyncio.Semaphore(4)
    errors: list[HTTPException] = []

    async def review(job: Job):
        """One call per role. Batching several roles into one reply made the model evaluate only the first."""
        listing = f"{job.title} @ {job.company} ({job.location}) level={job.level_tag}\n{(job.description or '')[:4500]}"  # no ids: the model must never see or repeat them
        async with sem:
            try:
                data = await json_chat(db, hiring.SYSTEM, f"RESUME:\n{resume_text}\n\nJOB:\n{listing}", temperature=0.15)
            except HTTPException as e:
                errors.append(e)
                return None
        item = data.get("evaluation") or next(iter(data.get("evaluations") or []), None)
        return job, (hiring.finalize(item, resume_text, f"{job.title}\n{job.description or ''}", resume.latex) if item else None)

    scored = 0
    for out in await asyncio.gather(*(review(j) for j in jobs)):
        if out and out[1]:
            job, detail = out
            uj = _upsert_state(db, uid, job.id)
            uj.score, uj.score_reason, uj.score_detail, uj.scored_resume_id = detail["score"], detail["summary"], detail, resume.id
            scored += 1
    db.commit()
    if charged and scored < len(jobs):
        entitlements.refund(db, user.tenant_id, user.id, "review", len(jobs) - scored)  # pay only for reviews actually delivered
    if scored == 0 and errors:
        raise errors[0]  # nothing worked: tell the user why (bad key, quota...) instead of a silent zero
    cache.bump(f"jobs:{uid}")
    return {"scored": scored}


@router.get("/{job_id}", response_model=JobDetail)
def get_job(job_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {**_view(job, db.get(UserJob, (user.id, job_id))), "description": job.description}


@router.patch("/{job_id}", response_model=JobOut)
def patch_job(job_id: int, body: JobPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    uj = _upsert_state(db, user.id, job_id)
    uj.status = body.status
    db.commit()
    cache.bump(f"jobs:{user.id}")
    return _view(job, uj)
