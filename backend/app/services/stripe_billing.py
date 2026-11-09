"""Stripe, over plain HTTPS. Checkout creates the subscription; webhooks keep our records in step with Stripe's.

Webhook rules: verify the signature over the exact raw body, reject stale timestamps (replay window), and make every
event idempotent (Stripe retries; money events are keyed by event id so a replay cannot double-count).
"""
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import BillingEvent, Subscription, Tenant
from . import billing, plans

API = "https://api.stripe.com/v1"
STATUS = {"active": "active", "trialing": "active", "past_due": "past_due", "unpaid": "past_due", "canceled": "canceled"}


def client() -> httpx.AsyncClient:  # replaced in tests
    return httpx.AsyncClient(timeout=20, auth=(settings.stripe_secret_key, ""), headers={"Stripe-Version": "2024-06-20"})


def price_map() -> dict[str, str]:
    try:
        return json.loads(settings.stripe_prices or "{}")
    except ValueError:
        return {}


def price_id(plan: str, interval: str, currency: str) -> Optional[str]:
    return price_map().get(f"{plan}:{interval}:{currency}")


def plan_for_price(pid: str) -> Optional[tuple[str, str, str]]:
    for key, v in price_map().items():
        if v == pid:
            plan, interval, currency = key.split(":")
            return plan, interval, currency
    return None


def verify_signature(payload: bytes, header: str, secret: str, tolerance: int = 300, now: Optional[float] = None) -> bool:
    """Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<raw body>">[,v1=...]"""
    try:
        parts = [p.split("=", 1) for p in header.split(",")]
        t = int(next(v for k, v in parts if k == "t"))
        sigs = [v for k, v in parts if k == "v1"]
    except (StopIteration, ValueError):
        return False
    if abs((now or time.time()) - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in sigs)


async def create_checkout(tenant: Tenant, email: str, plan: str, interval: str, currency: str, success_url: str, cancel_url: str) -> str:
    pid = price_id(plan, interval, currency)
    if not pid:
        raise ValueError(f"No Stripe price is configured for {plan}/{interval}/{currency}")
    meta = {"tenant_id": str(tenant.id), "plan": plan, "interval": interval, "currency": currency}
    data = {"mode": "subscription", "line_items[0][price]": pid, "line_items[0][quantity]": "1", "success_url": success_url, "cancel_url": cancel_url,
            "client_reference_id": str(tenant.id), "customer_email": email, "allow_promotion_codes": "true"}
    data.update({f"metadata[{k}]": v for k, v in meta.items()})
    data.update({f"subscription_data[metadata][{k}]": v for k, v in meta.items()})
    async with client() as c:
        r = await c.post(f"{API}/checkout/sessions", data=data)
        r.raise_for_status()
        return r.json()["url"]


async def create_portal(customer_id: str, return_url: str) -> str:
    async with client() as c:
        r = await c.post(f"{API}/billing_portal/sessions", data={"customer": customer_id, "return_url": return_url})
        r.raise_for_status()
        return r.json()["url"]


async def set_cancel(subscription_id: str, cancel: bool) -> None:
    async with client() as c:
        r = await c.post(f"{API}/subscriptions/{subscription_id}", data={"cancel_at_period_end": "true" if cancel else "false"})
        r.raise_for_status()


def _ts(v: Any) -> datetime:
    return datetime.fromtimestamp(int(v), tz=timezone.utc)


def _tenant_for(db: Session, obj: dict) -> Optional[Tenant]:
    tid = (obj.get("metadata") or {}).get("tenant_id") or obj.get("client_reference_id")
    if tid and str(tid).isdigit():
        return db.get(Tenant, int(tid))
    for key in ("subscription", "id"):
        sid = obj.get(key) if isinstance(obj.get(key), str) else None
        if sid:
            s = db.scalar(select(Subscription).where(Subscription.provider_subscription_id == sid))
            if s:
                return db.get(Tenant, s.tenant_id)
    cust = obj.get("customer")
    if isinstance(cust, str):
        s = db.scalar(select(Subscription).where(Subscription.provider_customer_id == cust).order_by(Subscription.id.desc()))
        if s:
            return db.get(Tenant, s.tenant_id)
    return None


def _upsert_subscription(db: Session, obj: dict) -> str:
    tenant = _tenant_for(db, obj)
    if tenant is None:
        return "ignored: unknown workspace"
    item = ((obj.get("items") or {}).get("data") or [{}])[0]
    price = item.get("price") or {}
    mapped = plan_for_price(price.get("id", "")) or ((obj.get("metadata") or {}).get("plan"), (obj.get("metadata") or {}).get("interval"), (obj.get("metadata") or {}).get("currency"))
    plan, interval, currency = mapped
    interval = interval or (price.get("recurring") or {}).get("interval") or "month"
    currency = (currency or price.get("currency") or "usd").upper()
    status = STATUS.get(obj.get("status", ""))
    if plan not in plans.BY_ID or status is None:
        return f"ignored: status {obj.get('status')}"  # e.g. "incomplete": no entitlement until Stripe says active
    sid = obj["id"]
    sub = db.scalar(select(Subscription).where(Subscription.provider_subscription_id == sid))
    if sub is not None and sub.tenant_id != tenant.id:
        return "ignored: subscription belongs to another workspace"  # never let one event rewrite someone else's plan
    if sub is None:
        old = billing.current(db, tenant.id)
        if old is not None and old.provider == "internal":  # a real subscription replaces a test-mode one
            old.status, old.canceled_at = "canceled", billing.now()
        sub = Subscription(tenant_id=tenant.id, provider="stripe", provider_subscription_id=sid)
        db.add(sub)
    sub.plan, sub.interval, sub.currency, sub.status = plan, interval, currency, status
    sub.provider_customer_id = obj.get("customer") or sub.provider_customer_id
    sub.current_period_start = _ts(obj.get("current_period_start") or item.get("current_period_start") or time.time())
    sub.current_period_end = _ts(obj.get("current_period_end") or item.get("current_period_end") or time.time())
    sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
    if status in billing.LIVE:
        tenant.plan = plan
    db.commit()
    return f"subscription {status}: {plan}/{interval}"


def apply_event(db: Session, event: dict) -> str:
    """Apply one verified Stripe event. Returns a short description (for logs and tests)."""
    typ, obj, eid = event.get("type", ""), (event.get("data") or {}).get("object") or {}, event.get("id", "")
    if typ in ("customer.subscription.created", "customer.subscription.updated"):
        return _upsert_subscription(db, obj)
    if typ == "customer.subscription.deleted":
        sub = db.scalar(select(Subscription).where(Subscription.provider_subscription_id == obj.get("id")))
        if not sub:
            return "ignored: unknown subscription"
        sub.status, sub.canceled_at = "canceled", billing.now()
        tenant = db.get(Tenant, sub.tenant_id)
        if tenant:
            tenant.plan = "cadet"
        billing.log(db, sub.tenant_id, "cancel", sub.plan, provider="stripe", ref=f"{eid}:cancel", note="Subscription ended")
        db.commit()
        return "subscription canceled"
    if typ in ("invoice.paid", "invoice.payment_failed"):
        if eid and db.scalar(select(BillingEvent.id).where(BillingEvent.provider_ref == eid)):
            return "duplicate"
        tenant = _tenant_for(db, obj)
        if tenant is None:
            return "ignored: unknown workspace"
        ok = typ == "invoice.paid"
        sub = billing.current(db, tenant.id)
        if not ok and sub is not None:
            sub.status = "past_due"
        billing.log(db, tenant.id, "payment" if ok else "payment_failed", sub.plan if sub else None, int(obj.get("amount_paid" if ok else "amount_due") or 0),
                    (obj.get("currency") or "usd").upper(), "paid" if ok else "failed", "stripe", eid or None, obj.get("hosted_invoice_url"))
        db.commit()
        return "payment recorded" if ok else "payment failure recorded"
    if typ == "checkout.session.completed":
        tenant = _tenant_for(db, obj)
        if tenant is not None and obj.get("customer"):  # remember the customer so the portal works before the subscription event lands
            sub = billing.current(db, tenant.id)
            if sub is not None and sub.provider == "stripe":
                sub.provider_customer_id = obj["customer"]
                db.commit()
        return "checkout completed"
    return f"ignored: {typ}"
