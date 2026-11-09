import io
import re
import zipfile

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Job, Resume, ResumeVersion, User
from ..schemas import (
    AtsRequest,
    CompileRequest,
    ResumeCreate,
    ResumeListItem,
    ResumeOut,
    ResumeUpdate,
    TailorRequest,
    TailorResult,
    VersionCreate,
    VersionOut,
)
from ..services import ats as ats_service
from ..services import entitlements
from ..services import templates as template_service
from ..services import latex as latex_service
from ..services.tailor import tailor_resume

router = APIRouter(prefix="/resumes", tags=["resumes"])


def _get(db: Session, resume_id: int, user: User) -> Resume:
    """Fetch a resume that belongs to this user. Someone else's id answers 404, never 403, so ids cannot be probed."""
    r = db.get(Resume, resume_id)
    if not r or r.user_id != user.id:
        raise HTTPException(404, "Resume not found")
    return r


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_") or "resume"


def _pdf_response(result: latex_service.CompileResult, filename: str | None = None) -> Response:
    if result.ok and result.pdf:
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'} if filename else {}
        return Response(result.pdf, media_type="application/pdf", headers=headers)
    return JSONResponse(
        status_code=422 if result.available else 501,
        content={"detail": {"errors": result.errors, "log": result.log}},
    )


async def _export(latex: str, name: str, fmt: str) -> Response:
    base = _slug(name)
    if fmt == "tex":
        return Response(
            latex.encode(), media_type="application/x-tex",
            headers={"Content-Disposition": f'attachment; filename="{base}.tex"'},
        )
    result = await latex_service.compile_latex(latex)
    if fmt == "pdf":
        return _pdf_response(result, f"{base}.pdf")
    if fmt == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(f"{base}.tex", latex)
            if result.ok and result.pdf:
                z.writestr(f"{base}.pdf", result.pdf)
        return Response(
            buf.getvalue(), media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{base}.zip"'},
        )
    raise HTTPException(400, "format must be pdf, tex or zip")


@router.get("", response_model=list[ResumeListItem])
def list_resumes(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(Resume).where(Resume.user_id == user.id).order_by(Resume.updated_at.desc())).all()
    counts = dict(db.execute(select(ResumeVersion.resume_id, func.count()).where(ResumeVersion.resume_id.in_([r.id for r in rows])).group_by(ResumeVersion.resume_id)).all()) if rows else {}
    return [
        ResumeListItem(id=r.id, name=r.name, created_at=r.created_at, updated_at=r.updated_at,
                       version_count=counts.get(r.id, 0))
        for r in rows
    ]


@router.post("", response_model=ResumeOut, status_code=201)
def create_resume(body: ResumeCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    entitlements.require_room(db, user, "resumes")
    r = Resume(name=body.name, latex=body.latex, user_id=user.id, tenant_id=user.tenant_id)
    db.add(r)
    db.commit()
    return r


class FromTemplate(BaseModel):
    template_id: str
    name: str = Field(default="", max_length=200)
    paper: str = Field(default="a4paper", pattern="^(a4paper|letterpaper)$")
    use_profile: bool = True


@router.post("/from-template", response_model=ResumeOut, status_code=201)
def create_from_template(body: FromTemplate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .profile import load_profile

    entitlements.require_template(db, user, body.template_id)  # unknown id is a 404 before anything else
    entitlements.require_room(db, user, "resumes")
    profile = load_profile(db, user).model_dump() if body.use_profile else None
    try:
        latex = template_service.render(body.template_id, body.paper, profile)
    except KeyError:
        raise HTTPException(404, "Unknown template")
    meta = next(t for t in template_service.TEMPLATES if t["id"] == body.template_id)
    r = Resume(name=body.name.strip() or f"{meta['name']} resume", latex=latex, user_id=user.id, tenant_id=user.tenant_id)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.post("/compile")
async def compile_adhoc(body: CompileRequest):
    return _pdf_response(await latex_service.compile_latex(body.latex))


@router.get("/{resume_id}", response_model=ResumeOut)
def get_resume(resume_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _get(db, resume_id, user)


@router.put("/{resume_id}", response_model=ResumeOut)
def update_resume(resume_id: int, body: ResumeUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    r = _get(db, resume_id, user)
    if body.name is not None:
        r.name = body.name
    if body.latex is not None:
        r.latex = body.latex
    db.commit()
    return r


@router.delete("/{resume_id}", status_code=204)
def delete_resume(resume_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    db.delete(_get(db, resume_id, user))
    db.commit()


@router.get("/{resume_id}/export")
async def export_resume(resume_id: int, format: str = Query("pdf"), db: Session = Depends(get_db), user: User = Depends(current_user)):
    r = _get(db, resume_id, user)
    return await _export(r.latex, r.name, format)


# ---------- versions ----------
@router.get("/{resume_id}/versions", response_model=list[VersionOut])
def list_versions(resume_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _get(db, resume_id, user)
    return db.scalars(
        select(ResumeVersion).where(ResumeVersion.resume_id == resume_id).order_by(ResumeVersion.created_at.desc())
    ).all()


@router.post("/{resume_id}/versions", response_model=VersionOut, status_code=201)
def create_version(resume_id: int, body: VersionCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _get(db, resume_id, user)
    label = body.label or " – ".join(x for x in (body.company, body.job_title) if x) or "Snapshot"
    v = ResumeVersion(resume_id=resume_id, label=label, **body.model_dump(exclude={"label"}))
    db.add(v)
    db.commit()
    return v


@router.delete("/{resume_id}/versions/{version_id}", status_code=204)
def delete_version(resume_id: int, version_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _get(db, resume_id, user)  # ownership first: without this anyone could delete any version by guessing ids
    v = db.get(ResumeVersion, version_id)
    if not v or v.resume_id != resume_id:
        raise HTTPException(404, "Version not found")
    db.delete(v)
    db.commit()


@router.get("/{resume_id}/versions/{version_id}/export")
async def export_version(resume_id: int, version_id: int, format: str = Query("pdf"), db: Session = Depends(get_db), user: User = Depends(current_user)):
    r = _get(db, resume_id, user)
    v = db.get(ResumeVersion, version_id)
    if not v or v.resume_id != resume_id:
        raise HTTPException(404, "Version not found")
    return await _export(v.latex, f"{r.name}_{v.label}", format)


# ---------- AI tailoring ----------
@router.post("/{resume_id}/tailor", response_model=TailorResult)
async def tailor(resume_id: int, body: TailorRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    r = _get(db, resume_id, user)
    entitlements.charge(db, user, "tailor")
    jd, company, title = body.job_description, body.company, body.job_title
    if body.job_id:
        job = db.get(Job, body.job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        jd = jd or job.description
        company = company or job.company
        title = title or job.title
    return await tailor_resume(db, body.latex or r.latex, jd, company, title, body.instructions)


# ---------- ATS check ----------
@router.post("/{resume_id}/ats")
async def ats_check(resume_id: int, body: AtsRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    r = _get(db, resume_id, user)
    entitlements.charge(db, user, "ats_check")
    return await ats_service.analyze(db, body.latex or r.latex, body.job_description, body.company, body.job_title)
