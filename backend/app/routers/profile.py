"""Applicant profile (the details used to pre-fill applications) and the one-click "apply kit"."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Job, Resume, ResumeVersion, User
from ..services import context, entitlements, settings_store
from ..services.latex import latex_to_text
from ..services.llm import json_chat

router = APIRouter(tags=["profile"])
KEY = "applicant_profile"


class Profile(BaseModel):
    full_name: str = ""
    email: str = ""
    phone: str = ""
    city: str = ""
    linkedin: str = ""
    github: str = ""
    portfolio: str = ""
    degree: str = ""
    graduation_year: str = ""
    work_authorization: str = ""
    needs_sponsorship: str = ""
    notice_period: str = ""
    expected_ctc: str = ""
    pronouns: str = ""
    extra_notes: str = Field(default="", max_length=2000)


def load_profile(db: Session, user: User) -> Profile:
    raw = settings_store.get_value(db, KEY, user.id)
    try:
        return Profile(**json.loads(raw)) if raw else Profile()
    except (ValueError, TypeError):
        return Profile()


@router.get("/profile", response_model=Profile)
def get_profile(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return load_profile(db, user)


@router.put("/profile", response_model=Profile)
def put_profile(body: Profile, db: Session = Depends(get_db), user: User = Depends(current_user)):
    settings_store.set_value(db, KEY, body.model_dump_json(), user.id)
    return body


class KitRequest(BaseModel):
    resume_id: int
    version_id: Optional[int] = None
    tone: str = Field(default="warm", pattern="^(warm|formal|concise)$")


KIT_SYSTEM = """You prepare a job application for the candidate. Use ONLY facts in the resume text and profile. Never invent experience, numbers or skills.
Return JSON: {
 "cover_letter": "<150-230 words, specific to the company and role, 3 short paragraphs, no clichés, no placeholders>",
 "why_this_company": "<2-3 sentences, honest, based on the job description>",
 "why_this_role": "<2-3 sentences>",
 "strengths_answer": "<3 sentences for 'tell us about yourself / relevant experience'>",
 "referral_note": "<3 sentences the candidate could send a current employee to ask for a referral, no flattery>"
}"""


@router.post("/jobs/{job_id}/apply-kit")
async def apply_kit(job_id: int, body: KitRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    resume = db.get(Resume, body.resume_id)
    if not resume or resume.user_id != user.id:
        raise HTTPException(404, "Resume not found")
    latex = resume.latex
    version_label = None
    if body.version_id:
        v = db.get(ResumeVersion, body.version_id)
        if not v or v.resume_id != resume.id:
            raise HTTPException(404, "Version not found")
        latex, version_label = v.latex, v.label
    context.current_purpose.set("apply_kit")
    charged = entitlements.metered(db, "apply_kit")
    entitlements.charge(db, user, "apply_kit")
    profile = load_profile(db, user)
    prompt = (
        f"Tone: {body.tone}\nCompany: {job.company}\nRole: {job.title} ({job.location})\n\n"
        f"=== JOB DESCRIPTION ===\n{(job.description or '')[:6000]}\n\n"
        f"=== PROFILE ===\n{profile.model_dump_json()}\n\n=== RESUME TEXT ===\n{latex_to_text(latex)[:6000]}"
    )
    try:
        data = await json_chat(db, KIT_SYSTEM, prompt, temperature=0.4)
    except HTTPException:
        if charged:
            entitlements.refund(db, user.tenant_id, user.id, "apply_kit")
        raise
    return {
        "job": {"id": job.id, "title": job.title, "company": job.company, "url": job.url, "location": job.location},
        "resume": {"id": resume.id, "version_id": body.version_id, "label": version_label or resume.name},
        "cover_letter": str(data.get("cover_letter", "")),
        "answers": {
            "Why this company": str(data.get("why_this_company", "")),
            "Why this role": str(data.get("why_this_role", "")),
            "Tell us about yourself": str(data.get("strengths_answer", "")),
        },
        "referral_note": str(data.get("referral_note", "")),
    }
