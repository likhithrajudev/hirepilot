"""Plans, checkout, subscription state and the Stripe webhook."""
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_user
from ..models import BillingEvent, Tenant, User
from ..services import billing, entitlements, plans, stripe_billing

router = APIRouter(prefix="/billing", tags=["billing"])
public = APIRouter(prefix="/billing", tags=["billing"])

CURRENCIES = ("USD", "INR")


def _mode() -> str:
    return "stripe" if settings.stripe_enabled else "test"


@public.get("/plans")
def list_plans():
    return {**plans.as_json(), "mode": _mode(), "currencies": list(CURRENCIES), "sales_email": settings.sales_email}


def _tenant(db: Session, user: User) -> Tenant:
    t = db.get(Tenant, user.tenant_id)
    if not t:
        raise HTTPException(404, "Workspace not found")
    return t


def _owner_only(user: User) -> None:
    if user.role not in ("owner", "admin"):
        raise HTTPException(403, "Only a workspace owner or admin can change billing.")


@router.get("/subscription")
def subscription(db: Session = Depends(get_db), user: User = Depends(current_user)):
    tenant = _tenant(db, user)
    plan = billing.sync(db, tenant)
    sub = billing.current(db, tenant.id)
    return {
        "plan": {"id": plan.id, "name": plan.name}, "mode": _mode(), "can_manage": user.role in ("owner", "admin"),
        "subscription": None if sub is None else {
            "status": sub.status, "interval": sub.interval, "currency": sub.currency, "provider": sub.provider,
            "current_period_end": sub.current_period_end, "cancel_at_period_end": sub.cancel_at_period_end,
            "amount": billing.minor(sub.plan, sub.interval, sub.currency), "has_portal": bool(sub.provider == "stripe" and sub.provider_customer_id)},
        **entitlements.snapshot(db, user),
    }


class Checkout(BaseModel):
    plan: str = Field(pattern="^(pilot|captain)$")
    interval: str = Field(default="month", pattern="^(month|year)$")
    currency: str = Field(default="USD", pattern="^(USD|INR)$")


@router.post("/checkout")
async def checkout(body: Checkout, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _owner_only(user)
    tenant = _tenant(db, user)
    if settings.stripe_enabled:
        base = settings.public_base_url.rstrip("/")
        try:
            url = await stripe_billing.create_checkout(tenant, user.email, body.plan, body.interval, body.currency,
                                                       f"{base}/settings?section=billing&checkout=success", f"{base}/settings?section=billing&checkout=cancel")
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception:
            raise HTTPException(502, "Could not start checkout. Please try again.")
        return {"mode": "stripe", "url": url}
    sub = await run_in_threadpool(billing.start_internal, db, tenant, body.plan, body.interval, body.currency)
    return {"mode": "test", "url": None, "plan": sub.plan}


@router.post("/portal")
async def portal(db: Session = Depends(get_db), user: User = Depends(current_user)):
    _owner_only(user)
    sub = billing.current(db, user.tenant_id)
    if not settings.stripe_enabled or sub is None or sub.provider != "stripe" or not sub.provider_customer_id:
        raise HTTPException(400, "The billing portal is available once you have a paid subscription through Stripe.")
    try:
        return {"url": await stripe_billing.create_portal(sub.provider_customer_id, f"{settings.public_base_url.rstrip('/')}/settings?section=billing")}
    except Exception:
        raise HTTPException(502, "Could not open the billing portal. Please try again.")


async def _cancel(db: Session, user: User, cancel: bool) -> dict[str, Any]:
    _owner_only(user)
    tenant = _tenant(db, user)
    sub = billing.current(db, tenant.id)
    if sub is None:
        raise HTTPException(400, "There is no paid subscription to change.")
    if sub.provider == "stripe" and sub.provider_subscription_id:
        try:
            await stripe_billing.set_cancel(sub.provider_subscription_id, cancel)
        except Exception:
            raise HTTPException(502, "Could not reach Stripe. Please try again.")
    sub = await run_in_threadpool(billing.set_cancel, db, tenant, cancel)
    return {"cancel_at_period_end": sub.cancel_at_period_end, "current_period_end": sub.current_period_end}


@router.post("/cancel")
async def cancel(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return await _cancel(db, user, True)


@router.post("/resume")
async def resume(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return await _cancel(db, user, False)


@router.get("/invoices")
def invoices(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(BillingEvent).where(BillingEvent.tenant_id == user.tenant_id).order_by(BillingEvent.created_at.desc()).limit(60)).all()
    return [{"id": r.id, "created_at": r.created_at, "kind": r.kind, "plan": r.plan, "amount": r.amount, "currency": r.currency, "status": r.status,
             "provider": r.provider, "url": r.url, "note": r.note} for r in rows]


@public.post("/webhook/stripe")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    if not settings.stripe_enabled:
        raise HTTPException(404, "Not found")
    raw = await request.body()  # the exact bytes Stripe signed; never re-serialise before verifying
    if not stripe_billing.verify_signature(raw, request.headers.get("stripe-signature", ""), settings.stripe_webhook_secret):
        raise HTTPException(400, "Invalid signature")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid payload")
    result = await run_in_threadpool(stripe_billing.apply_event, db, event)
    return {"received": True, "result": result}
