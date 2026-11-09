"""Subscription lifecycle. Provider "internal" is test mode (no money moves); "stripe" is driven by webhooks."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BillingEvent, Subscription, Tenant
from . import plans
from .security import _aware, now

LIVE = ("active", "past_due")  # statuses that still grant the plan


def minor(plan_id: str, interval: str, currency: str) -> int:
    price = plans.get(plan_id).prices.get(currency, {}).get(interval)
    return int(price) * 100 if price else 0


def _add_period(start: datetime, interval: str) -> datetime:
    return start + (timedelta(days=365) if interval == "year" else timedelta(days=30))


def current(db: Session, tenant_id: int) -> Optional[Subscription]:
    return db.scalar(select(Subscription).where(Subscription.tenant_id == tenant_id, Subscription.status.in_(LIVE)).order_by(Subscription.id.desc()))


def log(db: Session, tenant_id: int, kind: str, plan: Optional[str] = None, amount: int = 0, currency: str = "USD", status: str = "paid",
        provider: str = "internal", ref: Optional[str] = None, url: Optional[str] = None, note: Optional[str] = None) -> None:
    db.add(BillingEvent(tenant_id=tenant_id, kind=kind, plan=plan, amount=amount, currency=currency, status=status, provider=provider,
                        provider_ref=ref, url=url, note=note))


def sync(db: Session, tenant: Tenant) -> plans.Plan:
    """Bring tenant.plan in line with reality and return it. Test-mode subscriptions renew or lapse lazily here, so no
    scheduler is needed. Stripe subscriptions are owned by webhooks and are never downgraded on a local clock."""
    sub = current(db, tenant.id)
    if sub is None:
        if tenant.plan != "cadet":
            tenant.plan = "cadet"
            db.commit()
        return plans.get("cadet")
    if sub.provider == "internal":
        end = _aware(sub.current_period_end)
        if now() >= end and sub.cancel_at_period_end:
            sub.status, sub.canceled_at, tenant.plan = "canceled", now(), "cadet"
            log(db, tenant.id, "cancel", sub.plan, note="Subscription ended at the close of the paid period", status="test")
            db.commit()
            return plans.get("cadet")
        renewed = 0
        while now() >= _aware(sub.current_period_end) and renewed < 36:  # test mode: catch up if nobody opened the app for a while
            sub.current_period_start = _aware(sub.current_period_end)
            sub.current_period_end = _add_period(_aware(sub.current_period_start), sub.interval)
            log(db, tenant.id, "renewal", sub.plan, minor(sub.plan, sub.interval, sub.currency), sub.currency, "test", "internal", note="Test-mode renewal, no charge")
            renewed += 1
        if renewed:
            db.commit()
    if tenant.plan != sub.plan:
        tenant.plan = sub.plan
        db.commit()
    return plans.get(sub.plan)


def start_internal(db: Session, tenant: Tenant, plan_id: str, interval: str, currency: str) -> Subscription:
    """Test-mode checkout: switch plans immediately, no proration, and record what would have been charged."""
    p = plans.get(plan_id)
    amount = minor(plan_id, interval, currency)
    sub = current(db, tenant.id)
    start = now()
    if sub is None or sub.provider != "internal":
        sub = Subscription(tenant_id=tenant.id, plan=plan_id, interval=interval, currency=currency, provider="internal")
        db.add(sub)
        kind = "payment"
    else:
        kind = "plan_change" if sub.plan != plan_id else "payment"
    sub.plan, sub.interval, sub.currency, sub.status = plan_id, interval, currency, "active"
    sub.current_period_start, sub.current_period_end, sub.cancel_at_period_end = start, _add_period(start, interval), False
    tenant.plan = plan_id
    log(db, tenant.id, kind, plan_id, amount, currency, "test", "internal", note=f"Test mode: {p.name} ({interval}ly), no real charge")
    db.commit()
    return sub


def set_cancel(db: Session, tenant: Tenant, cancel: bool) -> Subscription:
    sub = current(db, tenant.id)
    if sub is None:
        raise ValueError("no active subscription")
    sub.cancel_at_period_end = cancel
    log(db, tenant.id, "cancel" if cancel else "plan_change", sub.plan, provider=sub.provider, status="test" if sub.provider == "internal" else "paid",
        note="Will end at the close of the paid period" if cancel else "Cancellation withdrawn")
    db.commit()
    return sub
