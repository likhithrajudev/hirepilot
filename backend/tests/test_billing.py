import hashlib
import hmac
import json
import time
import uuid
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

from app.config import settings
from app.db import SessionLocal
from app.models import BillingEvent, FeatureUse, Subscription, Tenant, User
from app.schemas import TailorResult
from app.services import billing, entitlements, plans, stripe_billing
from app.services.security import now

LATEX = r"\documentclass{article}\begin{document}Hi\end{document}"


def tenant_id(client) -> int:
    return client.get("/api/auth/me").json()["tenant"]["id"]


def upgrade(client, plan="pilot", interval="month", currency="USD"):
    r = client.post("/api/billing/checkout", json={"plan": plan, "interval": interval, "currency": currency})
    assert r.status_code == 200, r.text
    return r.json()


def sub_state(client):
    return client.get("/api/billing/subscription").json()


# ---------------- the catalog ----------------
def test_catalog_is_public_and_the_marketing_copy_has_not_drifted(anon):
    r = anon.get("/api/billing/plans")
    assert r.status_code == 200
    data = r.json()
    assert [p["id"] for p in data["plans"]] == ["cadet", "pilot", "captain", "fleet"] and data["mode"] == "test"
    generated = Path(__file__).resolve().parents[2] / "frontend" / "lib" / "plans.generated.json"
    assert json.loads(generated.read_text()) == plans.as_json(), "prices/limits changed: regenerate with `python -m app.services.plans > ../frontend/lib/plans.generated.json`"
    limits = [p["limits"]["tailor"] for p in data["plans"][:3]]
    assert limits == sorted(limits) and None not in limits, "each paid tier must give more than the one below"
    assert plans.next_plan("cadet") == "pilot" and plans.next_plan("pilot") == "captain" and plans.next_plan("captain") is None


# ---------------- limits and the paywall ----------------
def test_free_plan_holds_one_resume_and_the_402_tells_you_what_to_do(client):
    assert client.post("/api/resumes", json={"name": "one", "latex": LATEX}).status_code == 201
    r = client.post("/api/resumes", json={"name": "two", "latex": LATEX})
    assert r.status_code == 402
    d = r.json()["detail"]
    assert d["code"] == "quota_exceeded" and d["feature"] == "resumes" and d["limit"] == 1 and d["used"] == 1 and d["upgrade_to"] == "pilot"
    assert "Cadet" in d["message"] and "upgrade" in d["message"].lower()
    upgrade(client, "pilot")
    assert client.post("/api/resumes", json={"name": "two", "latex": LATEX}).status_code == 201


def test_premium_templates_need_pilot(client):
    r = client.post("/api/resumes/from-template", json={"template_id": "modern"})
    assert r.status_code == 402 and r.json()["detail"]["code"] == "plan_required" and r.json()["detail"]["feature"] == "templates"
    assert client.post("/api/resumes/from-template", json={"template_id": "minimal"}).status_code == 201  # free
    upgrade(client, "pilot")
    assert client.post("/api/resumes/from-template", json={"template_id": "modern"}).status_code == 201


def _mock_tailor(monkeypatch):
    from app.routers import resumes as rr

    async def fake(db, latex, jd, company=None, title=None, extra=None, *a, **k):
        return TailorResult(latex=latex, changes=["x"])

    monkeypatch.setattr(rr, "tailor_resume", fake)


def test_monthly_ai_allowance_is_counted_and_enforced(client, monkeypatch):
    _mock_tailor(monkeypatch)
    rid = client.post("/api/resumes", json={"name": "r", "latex": LATEX}).json()["id"]
    for _ in range(3):  # Cadet: 3 a month
        assert client.post(f"/api/resumes/{rid}/tailor", json={"job_description": "jd"}).status_code == 200
    r = client.post(f"/api/resumes/{rid}/tailor", json={"job_description": "jd"})
    assert r.status_code == 402 and r.json()["detail"]["limit"] == 3 and r.json()["detail"]["used"] == 3
    snap = sub_state(client)["usage"]["tailor"]
    assert (snap["used"], snap["limit"], snap["remaining"]) == (3, 3, 0)
    upgrade(client, "pilot")
    assert client.post(f"/api/resumes/{rid}/tailor", json={"job_description": "jd"}).status_code == 200


def test_bringing_your_own_openai_key_lifts_ai_quotas_but_not_other_limits(client, monkeypatch):
    _mock_tailor(monkeypatch)
    client.put("/api/settings", json={"openai_api_key": "sk-test-own-key-1234"})
    rid = client.post("/api/resumes", json={"name": "r", "latex": LATEX}).json()["id"]
    for _ in range(6):
        assert client.post(f"/api/resumes/{rid}/tailor", json={"job_description": "jd"}).status_code == 200
    s = sub_state(client)
    assert s["own_key"] is True and s["usage"]["tailor"]["used"] == 0 and s["usage"]["tailor"]["unmetered_by_own_key"] is True
    assert client.post("/api/resumes", json={"name": "two", "latex": LATEX}).status_code == 402, "the resume cap still applies"


def test_usage_resets_each_month(client, monkeypatch):
    _mock_tailor(monkeypatch)
    rid = client.post("/api/resumes", json={"name": "r", "latex": LATEX}).json()["id"]
    start, _ = entitlements.month_window()
    with SessionLocal() as db:
        db.add(FeatureUse(tenant_id=tenant_id(client), user_id=client.user_id, feature="tailor", units=3, created_at=start - timedelta(days=2)))
        db.commit()
    assert sub_state(client)["usage"]["tailor"]["used"] == 0, "last month's usage must not count"
    assert client.post(f"/api/resumes/{rid}/tailor", json={"job_description": "jd"}).status_code == 200


def test_short_allowance_reviews_what_it_can_then_pays_the_402(client, monkeypatch):
    from app.routers import jobs as jobs_router
    from test_api import _add_job

    tag = uuid.uuid4().hex[:6]
    ids = [_add_job(title=f"Review {tag} {i}", description="Needs Java.") for i in range(5)]
    rid = client.post("/api/resumes", json={"name": "r", "latex": r"\documentclass{article}\begin{document}Java.\end{document}"}).json()["id"]
    with SessionLocal() as db:
        db.add(FeatureUse(tenant_id=tenant_id(client), user_id=client.user_id, feature="review", units=8))  # 8 of Cadet's 10 used
        db.commit()

    async def fake(db, system, user, temperature=0.3):
        return {"evaluation": {"must_haves": [], "technical_fit": 70, "impact": 70, "scope_fit": 70, "learning_agility": 70, "summary": "ok"}}

    monkeypatch.setattr(jobs_router, "json_chat", fake)
    assert client.post("/api/jobs/score", json={"resume_id": rid, "job_ids": ids, "limit": 5}).json() == {"scored": 2}, "5 asked, 2 left: review 2"
    assert sub_state(client)["usage"]["review"]["used"] == 10
    r = client.post("/api/jobs/score", json={"resume_id": rid, "job_ids": ids, "limit": 5})
    assert r.status_code == 402 and r.json()["detail"]["feature"] == "review"


def test_a_failed_ai_task_gives_the_unit_back(client, monkeypatch):
    from app.services import tasks as task_service

    async def boom(*a, **k):
        raise HTTPException(502, "OpenAI error: down")

    monkeypatch.setattr(task_service, "tailor_resume", boom)
    rid = client.post("/api/resumes", json={"name": "r", "latex": LATEX}).json()["id"]
    tid = client.post("/api/tasks", json={"kind": "tailor", "resume_id": rid, "payload": {"job_description": "jd"}}).json()["id"]
    for _ in range(60):
        if client.get(f"/api/tasks/{tid}").json()["status"] == "error":
            break
        time.sleep(0.1)
    assert client.get(f"/api/tasks/{tid}").json()["status"] == "error"
    assert sub_state(client)["usage"]["tailor"]["used"] == 0, "you must not pay for our failure"


def test_ai_task_over_the_limit_is_refused_up_front(client, monkeypatch):
    from app.services import tasks as task_service

    async def ok(*a, **k):
        return TailorResult(latex=LATEX, changes=["x"])

    monkeypatch.setattr(task_service, "tailor_resume", ok)
    rid = client.post("/api/resumes", json={"name": "r", "latex": LATEX}).json()["id"]
    for _ in range(3):
        assert client.post("/api/tasks", json={"kind": "tailor", "resume_id": rid, "payload": {"job_description": "jd"}}).status_code == 202
    r = client.post("/api/tasks", json={"kind": "tailor", "resume_id": rid, "payload": {"job_description": "jd"}})
    assert r.status_code == 402 and r.json()["detail"]["code"] == "quota_exceeded"


# ---------------- subscriptions (test mode) ----------------
def test_test_mode_checkout_switches_plans_immediately_and_records_it(client):
    assert sub_state(client)["plan"]["id"] == "cadet" and sub_state(client)["subscription"] is None
    assert upgrade(client, "pilot", "month", "USD")["mode"] == "test"
    s = sub_state(client)
    assert s["plan"]["id"] == "pilot" and s["subscription"]["status"] == "active" and s["subscription"]["amount"] == 1200 and s["mode"] == "test"
    assert s["usage"]["resumes"]["limit"] == 5
    upgrade(client, "captain", "year", "INR")
    s = sub_state(client)
    assert s["plan"]["id"] == "captain" and s["subscription"]["interval"] == "year" and s["subscription"]["amount"] == 499000 and s["usage"]["resumes"]["limit"] == 25
    kinds = [(e["kind"], e["status"]) for e in client.get("/api/billing/invoices").json()]
    assert ("payment", "test") in kinds and ("plan_change", "test") in kinds, "every change lands in the ledger, marked as test money"


def test_cancel_keeps_access_until_the_period_ends_then_drops_to_free(client):
    upgrade(client, "pilot")
    assert client.post("/api/billing/cancel").status_code == 200
    s = sub_state(client)
    assert s["plan"]["id"] == "pilot" and s["subscription"]["cancel_at_period_end"] is True, "you keep what you paid for"
    assert client.post("/api/billing/resume").json()["cancel_at_period_end"] is False
    client.post("/api/billing/cancel")
    with SessionLocal() as db:
        sub = db.query(Subscription).filter(Subscription.tenant_id == tenant_id(client)).one()
        sub.current_period_end = now() - timedelta(days=1)
        db.commit()
    s = sub_state(client)
    assert s["plan"]["id"] == "cadet" and s["subscription"] is None, "the period has ended"
    assert "cancel" in [e["kind"] for e in client.get("/api/billing/invoices").json()]


def test_downgrade_never_deletes_your_data_it_only_blocks_new_items(client):
    upgrade(client, "pilot")
    for i in range(3):
        assert client.post("/api/resumes", json={"name": f"r{i}", "latex": LATEX}).status_code == 201
    client.post("/api/billing/cancel")
    with SessionLocal() as db:
        db.query(Subscription).filter(Subscription.tenant_id == tenant_id(client)).one().current_period_end = now() - timedelta(minutes=1)
        db.commit()
    assert len(client.get("/api/resumes").json()) == 3, "over the free limit, but nothing is deleted"
    assert client.post("/api/resumes", json={"name": "new", "latex": LATEX}).status_code == 402


def test_test_mode_subscription_renews_lazily_and_logs_it(client):
    upgrade(client, "pilot")
    with SessionLocal() as db:
        db.query(Subscription).filter(Subscription.tenant_id == tenant_id(client)).one().current_period_end = now() - timedelta(days=1)
        db.commit()
    assert sub_state(client)["plan"]["id"] == "pilot"
    assert "renewal" in [e["kind"] for e in client.get("/api/billing/invoices").json()]


def test_only_owners_can_change_billing_and_invoices_are_private(make_user):
    a, b = make_user(), make_user()
    upgrade(a, "pilot")
    assert b.get("/api/billing/invoices").json() == [] and sub_state(b)["plan"]["id"] == "cadet", "B sees nothing of A's billing"
    with SessionLocal() as db:
        db.get(User, b.user_id).role = "member"
        db.commit()
    assert b.post("/api/billing/checkout", json={"plan": "pilot"}).status_code == 403
    assert b.post("/api/billing/cancel").status_code == 403
    assert sub_state(b)["can_manage"] is False
    assert a.post("/api/billing/checkout", json={"plan": "fleet"}).status_code == 422, "teams talk to sales; there is no self-serve Fleet"
    assert a.post("/api/billing/cancel").status_code == 200


def test_billing_requires_sign_in(anon):
    for method, path in (("get", "/api/billing/subscription"), ("post", "/api/billing/checkout"), ("get", "/api/billing/invoices"), ("post", "/api/billing/cancel")):
        assert getattr(anon, method)(path).status_code == 401


# ---------------- Stripe ----------------
SECRET = "whsec_test_secret"


@pytest.fixture()
def stripe_on(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_webhook_secret", SECRET)
    monkeypatch.setattr(settings, "stripe_prices", json.dumps({"pilot:month:USD": "price_pilot_m", "captain:month:USD": "price_cap_m", "captain:year:USD": "price_cap_y"}))


def signed(body: dict, ts: int | None = None, secret: str = SECRET):
    raw = json.dumps(body).encode()
    t = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return raw, {"Stripe-Signature": f"t={t},v1={sig}", "Content-Type": "application/json"}


def sub_event(client, typ="customer.subscription.created", status="active", price="price_cap_m", sid="sub_x", customer="cus_x", cancel=False, eid=None):
    return {"id": eid or f"evt_{uuid.uuid4().hex[:10]}", "type": typ, "data": {"object": {
        "id": sid, "customer": customer, "status": status, "cancel_at_period_end": cancel,
        "current_period_start": int(time.time()), "current_period_end": int(time.time()) + 30 * 86400,
        "metadata": {"tenant_id": str(tenant_id(client))}, "items": {"data": [{"price": {"id": price, "currency": "usd", "recurring": {"interval": "month"}}}]}}}}


def test_webhook_is_off_when_stripe_is_not_configured(anon):
    raw, h = signed({"id": "evt_1", "type": "x"})
    assert anon.post("/api/billing/webhook/stripe", content=raw, headers=h).status_code == 404


def test_webhook_rejects_bad_stale_and_missing_signatures(anon, stripe_on):
    raw, h = signed({"id": "evt_1", "type": "x", "data": {"object": {}}})
    assert anon.post("/api/billing/webhook/stripe", content=raw, headers=h).status_code == 200
    forged_raw, forged_h = signed({"id": "evt_1", "type": "x", "data": {"object": {}}}, secret="whsec_wrong")
    assert anon.post("/api/billing/webhook/stripe", content=forged_raw, headers=forged_h).status_code == 400
    stale_raw, stale_h = signed({"id": "evt_1", "type": "x", "data": {"object": {}}}, ts=int(time.time()) - 3600)
    assert anon.post("/api/billing/webhook/stripe", content=stale_raw, headers=stale_h).status_code == 400, "an hour-old signature is a replay"
    tampered = raw.replace(b'"x"', b'"y"')
    assert anon.post("/api/billing/webhook/stripe", content=tampered, headers=h).status_code == 400, "changing the body invalidates the signature"
    assert anon.post("/api/billing/webhook/stripe", content=raw).status_code == 400


def test_stripe_subscription_lifecycle_through_webhooks(client, stripe_on):
    def send(ev):
        raw, h = signed(ev)
        r = client.post("/api/billing/webhook/stripe", content=raw, headers=h)
        assert r.status_code == 200, r.text
        return r.json()["result"]

    sid, cus = f"sub_{uuid.uuid4().hex[:10]}", f"cus_{uuid.uuid4().hex[:10]}"
    assert "active" in send(sub_event(client, sid=sid, customer=cus))
    s = sub_state(client)
    assert s["plan"]["id"] == "captain" and s["subscription"]["provider"] == "stripe" and s["subscription"]["has_portal"] is True and s["mode"] == "stripe"
    pay = {"id": f"evt_inv_{sid}", "type": "invoice.paid", "data": {"object": {"subscription": sid, "customer": cus, "amount_paid": 2900, "currency": "usd", "hosted_invoice_url": "https://invoice.stripe.com/i/1"}}}
    assert send(pay) == "payment recorded" and send(pay) == "duplicate", "a retried event must not be counted twice"
    inv = [e for e in client.get("/api/billing/invoices").json() if e["provider"] == "stripe"]
    assert len(inv) == 1 and inv[0]["amount"] == 2900 and inv[0]["url"] == "https://invoice.stripe.com/i/1" and inv[0]["status"] == "paid"
    fail = {"id": f"evt_fail_{sid}", "type": "invoice.payment_failed", "data": {"object": {"subscription": sid, "customer": cus, "amount_due": 2900, "currency": "usd"}}}
    send(fail)
    assert sub_state(client)["subscription"]["status"] == "past_due" and sub_state(client)["plan"]["id"] == "captain", "grace: a failed card does not instantly cut access"
    send(sub_event(client, "customer.subscription.updated", cancel=True, sid=sid, customer=cus))
    assert sub_state(client)["subscription"]["cancel_at_period_end"] is True
    send({"id": f"evt_del_{sid}", "type": "customer.subscription.deleted", "data": {"object": {"id": sid}}})
    s = sub_state(client)
    assert s["plan"]["id"] == "cadet" and s["subscription"] is None


def test_incomplete_and_unknown_events_grant_nothing(client, stripe_on):
    def send(ev):
        raw, h = signed(ev)
        return client.post("/api/billing/webhook/stripe", content=raw, headers=h).json()["result"]

    assert send(sub_event(client, status="incomplete", sid=f"sub_{uuid.uuid4().hex[:10]}")).startswith("ignored")
    assert sub_state(client)["plan"]["id"] == "cadet", "no entitlement until Stripe says the payment succeeded"
    assert send({"id": "evt_x", "type": "customer.created", "data": {"object": {}}}).startswith("ignored")
    stranger = sub_event(client, sid=f"sub_{uuid.uuid4().hex[:10]}")
    stranger["data"]["object"]["metadata"]["tenant_id"] = "999999999"
    assert "unknown workspace" in send(stranger)


def test_a_real_subscription_replaces_a_test_mode_one(client, stripe_on, monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "")  # test-mode checkout first
    upgrade(client, "pilot")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    raw, h = signed(sub_event(client, sid=f"sub_{uuid.uuid4().hex[:10]}", customer=f"cus_{uuid.uuid4().hex[:10]}"))
    client.post("/api/billing/webhook/stripe", content=raw, headers=h)
    with SessionLocal() as db:
        subs = db.query(Subscription).filter(Subscription.tenant_id == tenant_id(client)).all()
        assert sorted((s.provider, s.status) for s in subs) == [("internal", "canceled"), ("stripe", "active")]


def test_stripe_checkout_sends_the_right_request(client, stripe_on, monkeypatch):
    seen = {}

    def handler(req: httpx.Request):
        seen["form"] = dict(httpx.QueryParams(req.content.decode()))
        seen["auth"] = req.headers["authorization"]
        return httpx.Response(200, json={"url": "https://checkout.stripe.com/c/pay/cs_test_1"})

    monkeypatch.setattr(stripe_billing, "client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler), auth=("sk_test_123", "")))
    r = client.post("/api/billing/checkout", json={"plan": "captain", "interval": "year", "currency": "USD"})
    assert r.status_code == 200 and r.json() == {"mode": "stripe", "url": "https://checkout.stripe.com/c/pay/cs_test_1"}
    f = seen["form"]
    assert f["mode"] == "subscription" and f["line_items[0][price]"] == "price_cap_y" and f["client_reference_id"] == str(tenant_id(client))
    assert f["metadata[tenant_id]"] == str(tenant_id(client)) and f["subscription_data[metadata][plan]"] == "captain" and f["customer_email"] == client.email
    assert "/settings?section=billing" in f["success_url"]
    assert sub_state(client)["plan"]["id"] == "cadet", "starting checkout grants nothing; only the webhook does"
    assert client.post("/api/billing/checkout", json={"plan": "pilot", "interval": "year", "currency": "USD"}).status_code == 400, "no price configured for that combination"


def test_signature_helper_matches_stripes_documented_scheme():
    body = b'{"a":1}'
    t = 1_700_000_000
    good = hmac.new(b"s3cret", f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    assert stripe_billing.verify_signature(body, f"t={t},v1={good}", "s3cret", now=t + 10)
    assert stripe_billing.verify_signature(body, f"t={t},v1=deadbeef,v1={good}", "s3cret", now=t + 10), "any one valid v1 is enough (key rotation)"
    assert not stripe_billing.verify_signature(body, f"t={t},v1={good}", "s3cret", now=t + 301)
    assert not stripe_billing.verify_signature(body, "garbage", "s3cret")
    assert not stripe_billing.verify_signature(body, f"t={t},v1={good}", "other-secret", now=t)


def test_an_event_cannot_rewrite_another_workspaces_subscription(make_user, stripe_on):
    a, b = make_user(), make_user()
    sid = f"sub_{uuid.uuid4().hex[:10]}"
    raw, h = signed(sub_event(a, sid=sid, customer=f"cus_{uuid.uuid4().hex[:8]}", price="price_cap_m"))
    a.post("/api/billing/webhook/stripe", content=raw, headers=h)
    assert sub_state(a)["plan"]["id"] == "captain"
    hijack = sub_event(b, sid=sid, price="price_pilot_m")  # names A's subscription but claims B's workspace
    raw, h = signed(hijack)
    assert "another workspace" in b.post("/api/billing/webhook/stripe", content=raw, headers=h).json()["result"]
    assert sub_state(a)["plan"]["id"] == "captain" and sub_state(b)["plan"]["id"] == "cadet"
