"""What a workspace may do, and how much it has used. Limits come from the plan catalog; usage from FeatureUse rows."""
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import FeatureUse, Resume, Tenant, User
from . import billing, plans, settings_store


def month_window(ref: Optional[datetime] = None) -> tuple[datetime, datetime]:
    ref = ref or datetime.now(timezone.utc)
    start = ref.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    nxt = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return start, nxt


def paywall(code: str, feature: str, plan: plans.Plan, message: str, limit: Optional[int] = None, used: Optional[int] = None) -> HTTPException:
    """402 with a machine-readable body the app turns into an upgrade prompt. The text is already user-ready."""
    return HTTPException(402, detail={"code": code, "feature": feature, "plan": plan.id, "limit": limit, "used": used,
                                      "upgrade_to": plans.next_plan(plan.id), "message": message})


def plan_of(db: Session, user: User) -> plans.Plan:
    tenant = db.get(Tenant, user.tenant_id)
    return billing.sync(db, tenant) if tenant else plans.get("cadet")


def uses_own_key(db: Session) -> bool:
    return settings_store.get_openai_key(db)[1] == "ui"


def used(db: Session, tenant_id: int, feature: str) -> int:
    if plans.METERED[feature]["period"] == "total":
        raise ValueError("total limits are counted from the data itself")
    start, nxt = month_window()
    return db.scalar(select(func.coalesce(func.sum(FeatureUse.units), 0)).where(
        FeatureUse.tenant_id == tenant_id, FeatureUse.feature == feature, FeatureUse.created_at >= start, FeatureUse.created_at < nxt)) or 0


def _total_count(db: Session, user: User, feature: str) -> int:
    if feature == "resumes":
        return db.scalar(select(func.count()).select_from(Resume).where(Resume.tenant_id == user.tenant_id)) or 0
    return 0


def snapshot(db: Session, user: User) -> dict[str, Any]:
    plan = plan_of(db, user)
    own = uses_own_key(db)
    rows = {}
    for key, meta in plans.METERED.items():
        limit = plan.limits.get(key)
        n = _total_count(db, user, key) if meta["period"] == "total" else used(db, user.tenant_id, key)
        rows[key] = {"label": meta["label"], "unit": meta["unit"], "period": meta["period"], "used": n, "limit": limit,
                     "remaining": None if limit is None else max(0, limit - n), "unmetered_by_own_key": own and key in plans.AI_FEATURES}
    start, nxt = month_window()
    return {"usage": rows, "resets_at": nxt.isoformat(), "own_key": own}  # no "plan" key here: the caller owns that name


def charge(db: Session, user: User, feature: str, units: int = 1, partial: bool = False) -> int:
    """Reserve `units` of a monthly allowance and return how many were granted (less than asked only with partial=True).
    Raises 402 when nothing can be granted. AI features are free of quota when the user pays OpenAI with their own key."""
    plan = plan_of(db, user)
    if feature in plans.AI_FEATURES and uses_own_key(db):
        return units
    limit = plan.limits.get(feature)
    if limit is None:
        db.add(FeatureUse(tenant_id=user.tenant_id, user_id=user.id, feature=feature, units=units))
        db.commit()
        return units
    # Serialise concurrent charges for one workspace so two tabs cannot both spend the last unit.
    db.execute(select(Tenant.id).where(Tenant.id == user.tenant_id).with_for_update())
    already = used(db, user.tenant_id, feature)
    remaining = limit - already
    label = plans.METERED[feature]["label"].lower()
    if remaining <= 0 or (units > remaining and not partial):
        raise paywall("quota_exceeded", feature, plan,
                      f"You have used all {limit} {plans.METERED[feature]['unit']} on the {plan.name} plan this month." if remaining <= 0
                      else f"That needs {units} {plans.METERED[feature]['unit']} but only {remaining} are left on the {plan.name} plan this month.", limit, already)
    granted = min(units, remaining)
    db.add(FeatureUse(tenant_id=user.tenant_id, user_id=user.id, feature=feature, units=granted))
    db.commit()
    return granted


def require_room(db: Session, user: User, feature: str) -> None:
    """For 'total' limits such as how many resumes you can hold."""
    plan = plan_of(db, user)
    limit = plan.limits.get(feature)
    if limit is None:
        return
    n = _total_count(db, user, feature)
    if n >= limit:
        raise paywall("quota_exceeded", feature, plan, f"The {plan.name} plan holds {limit} {plans.METERED[feature]['unit']}. Delete one or upgrade for more room.", limit, n)


def require_template(db: Session, user: User, template_id: str) -> None:
    if template_id not in plans.ALL_TEMPLATES:
        raise HTTPException(404, "Unknown template")  # a typo is a 404, not an upsell
    plan = plan_of(db, user)
    if template_id not in plan.templates:
        raise paywall("plan_required", "templates", plan, f"The {template_id.title()} template is part of Pilot and above.")


def metered(db: Session, feature: str) -> bool:
    """Whether this action draws on the monthly allowance (AI actions on the user's own OpenAI key do not)."""
    return not (feature in plans.AI_FEATURES and uses_own_key(db))


def refund(db: Session, tenant_id: int, user_id: Optional[int], feature: str, units: int = 1) -> None:
    """Give units back when our side failed (provider outage, cancelled job). Recorded as a negative row, never a delete,
    so the ledger stays append-only."""
    if units > 0:
        db.add(FeatureUse(tenant_id=tenant_id, user_id=user_id, feature=feature, units=-units))
        db.commit()
