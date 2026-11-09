"""Platform operations. Every endpoint enforces platform-admin authorization on the server."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import platform_admin
from ..models import AdminAudit, CandidateApplication, FeatureUse, HiringJob, InterviewSession, Subscription, Tenant, UsageEvent, User
from ..services import entitlements, plans
from .interviews import _public

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(platform_admin)])


def audit(db, admin, action, target, detail=None):
    db.add(AdminAudit(admin_id=admin.id, action=action, target=str(target), detail=detail or {}))


def target_user(db, uid):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(404, "User not found")
    return user


@router.get("/overview")
def overview(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    def count(model, *filters):
        return db.scalar(select(func.count()).select_from(model).where(*filters)) or 0
    calls, cost, failures, latency = db.execute(select(func.count(UsageEvent.id), func.coalesce(func.sum(UsageEvent.cost_usd), 0),
        func.count().filter(UsageEvent.ok.is_(False)), func.coalesce(func.avg(UsageEvent.duration_ms), 0)).where(UsageEvent.created_at >= since)).one()
    daily = db.execute(select(func.date(UsageEvent.created_at).label("day"), func.count(), func.sum(UsageEvent.cost_usd)).where(UsageEvent.created_at >= since).group_by(func.date(UsageEvent.created_at)).order_by(func.date(UsageEvent.created_at))).all()
    purposes = db.execute(select(UsageEvent.purpose, func.count(), func.sum(UsageEvent.cost_usd), func.avg(UsageEvent.duration_ms)).where(UsageEvent.created_at >= since).group_by(UsageEvent.purpose)).all()
    return {"days": days, "users": count(User), "active_users": count(User, User.is_active.is_(True)),
            "engaged_users": db.scalar(select(func.count(func.distinct(UsageEvent.user_id))).where(UsageEvent.created_at >= since)) or 0,
            "interviews": count(InterviewSession, InterviewSession.created_at >= since), "applications": count(CandidateApplication, CandidateApplication.created_at >= since),
            "published_jobs": count(HiringJob, HiringJob.status == "published"), "ai_calls": calls, "estimated_cost_usd": float(cost),
            "failures": failures, "average_latency_ms": round(float(latency)),
            "daily": [{"day": str(d), "calls": n, "estimated_cost_usd": float(c or 0)} for d, n, c in daily],
            "purposes": [{"purpose": p, "calls": n, "estimated_cost_usd": float(c or 0), "average_latency_ms": round(float(ms or 0))} for p, n, c, ms in purposes]}


@router.get("/users")
def users(q: str = Query("", max_length=200), page: int = Query(1, ge=1), db: Session = Depends(get_db)):
    filters = [or_(User.email.ilike(f"%{q}%"), User.name.ilike(f"%{q}%"))] if q else []
    total = db.scalar(select(func.count(User.id)).where(*filters)) or 0
    rows = db.scalars(select(User).where(*filters).order_by(User.created_at.desc()).offset((page - 1) * 30).limit(30)).all()
    return {"total": total, "page": page, "items": [{"id": u.id, "name": u.name, "email": u.email, "active": u.is_active,
        "admin": u.is_platform_admin, "created_at": u.created_at, "last_login_at": u.last_login_at,
        "plan": (db.get(Tenant, u.tenant_id).plan if db.get(Tenant, u.tenant_id) else "cadet")} for u in rows]}


@router.get("/users/{uid}")
def user_detail(uid: int, db: Session = Depends(get_db)):
    u = target_user(db, uid)
    sub = db.scalar(select(Subscription).where(Subscription.tenant_id == u.tenant_id).order_by(Subscription.id.desc()))
    start, end = entitlements.month_window()
    uses = db.execute(select(FeatureUse.feature, func.sum(FeatureUse.units)).where(FeatureUse.tenant_id == u.tenant_id, FeatureUse.created_at >= start, FeatureUse.created_at < end).group_by(FeatureUse.feature)).all()
    usage = db.execute(select(func.count(UsageEvent.id), func.coalesce(func.sum(UsageEvent.cost_usd), 0)).where(UsageEvent.user_id == uid)).one()
    return {"id": u.id, "name": u.name, "email": u.email, "active": u.is_active, "admin": u.is_platform_admin, "tenant_id": u.tenant_id,
        "created_at": u.created_at, "last_login_at": u.last_login_at, "monthly_usage": dict(uses), "ai_calls": usage[0], "estimated_cost_usd": float(usage[1]),
        "subscription": {"plan": sub.plan, "status": sub.status, "provider": sub.provider, "interval": sub.interval, "currency": sub.currency,
                         "current_period_end": sub.current_period_end, "cancel_at_period_end": sub.cancel_at_period_end} if sub else None}


class BlockBody(BaseModel):
    blocked: bool
    reason: str = Field(min_length=3, max_length=500)


@router.post("/users/{uid}/block")
def block_user(uid: int, body: BlockBody, db: Session = Depends(get_db), admin: User = Depends(platform_admin)):
    u = target_user(db, uid)
    if uid == admin.id or u.is_platform_admin:
        raise HTTPException(409, "Platform administrators cannot be blocked here.")
    u.is_active = not body.blocked
    u.token_version += 1
    audit(db, admin, "user.block" if body.blocked else "user.unblock", f"user:{uid}", {"reason": body.reason})
    db.commit()
    return {"active": u.is_active}


class ResetBody(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/users/{uid}/reset-usage")
def reset_usage(uid: int, body: ResetBody, db: Session = Depends(get_db), admin: User = Depends(platform_admin)):
    u = target_user(db, uid)
    db.execute(select(Tenant.id).where(Tenant.id == u.tenant_id).with_for_update())
    reset = {}
    for feature, meta in plans.METERED.items():
        if meta["period"] != "month":
            continue
        units = max(0, entitlements.used(db, u.tenant_id, feature))
        if units:
            db.add(FeatureUse(tenant_id=u.tenant_id, user_id=u.id, feature=feature, units=-units))
            reset[feature] = units
    audit(db, admin, "usage.reset", f"tenant:{u.tenant_id}", {"reason": body.reason, "units": reset, "requested_for_user": uid})
    db.commit()
    return {"reset": reset, "tenant_id": u.tenant_id}


@router.get("/usage")
def usage(page: int = Query(1, ge=1), user_id: int | None = None, db: Session = Depends(get_db)):
    filters = [UsageEvent.user_id == user_id] if user_id else []
    rows = db.scalars(select(UsageEvent).where(*filters).order_by(UsageEvent.id.desc()).offset((page - 1) * 50).limit(50)).all()
    return {"total": db.scalar(select(func.count(UsageEvent.id)).where(*filters)) or 0,
            "items": [{"id": e.id, "at": e.created_at, "user_id": e.user_id, "purpose": e.purpose, "model": e.model,
                       "input_tokens": e.input_tokens, "output_tokens": e.output_tokens, "estimated_cost_usd": e.cost_usd,
                       "duration_ms": e.duration_ms, "ok": e.ok} for e in rows]}


@router.get("/interviews")
def interviews(page: int = Query(1, ge=1), user_id: int | None = None, db: Session = Depends(get_db)):
    filters = [InterviewSession.user_id == user_id] if user_id else []
    rows = db.scalars(select(InterviewSession).where(*filters).order_by(InterviewSession.created_at.desc()).offset((page - 1) * 30).limit(30)).all()
    return {"total": db.scalar(select(func.count(InterviewSession.id)).where(*filters)) or 0,
            "items": [{**_public(s, full=False), "user_id": s.user_id} for s in rows]}


@router.get("/interviews/{sid}")
def interview_detail(sid: int, db: Session = Depends(get_db), admin: User = Depends(platform_admin)):
    s = db.get(InterviewSession, sid)
    if not s:
        raise HTTPException(404, "Interview not found")
    audit(db, admin, "interview.view", f"interview:{sid}")
    db.commit()
    return {**_public(s), "user_id": s.user_id}


@router.get("/audit")
def audit_log(db: Session = Depends(get_db)):
    rows = db.scalars(select(AdminAudit).order_by(AdminAudit.id.desc()).limit(100)).all()
    return [{"id": e.id, "at": e.created_at, "admin_id": e.admin_id, "action": e.action, "target": e.target, "detail": e.detail} for e in rows]


@router.post("/interviews/{sid}/report")
async def generate_report(sid: int, db: Session = Depends(get_db), admin: User = Depends(platform_admin)):
    from .interviews import finish
    s = db.get(InterviewSession, sid)
    if not s:
        raise HTTPException(404, "Interview not found")
    if s.status != "done":
        raise HTTPException(409, "Wait until the candidate finishes their interview")
    owner = target_user(db, s.user_id)
    result = await finish(sid, db, owner, regenerate=True)
    audit(db, admin, "interview.report", f"interview:{sid}")
    db.commit()
    return {**result, "user_id": owner.id}
