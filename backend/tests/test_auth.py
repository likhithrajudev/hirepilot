import time
import uuid

import jwt
import pytest

from app.config import settings
from app.services import security

from conftest import PASSWORD, signup

LATEX = r"\documentclass{article}\begin{document}Hello\end{document}"


def cookie_of(resp) -> str | None:
    return resp.cookies.get("hp_refresh")


# ---------------- sign-up / sign-in ----------------
def test_signup_returns_a_session_and_an_httponly_refresh_cookie(anon):
    email, data = signup(anon, name="Ada Lovelace")
    assert data["token_type"] == "bearer" and data["expires_in"] == settings.access_token_minutes * 60
    assert data["user"]["email"] == email and data["user"]["name"] == "Ada Lovelace" and data["user"]["tenant"]["plan"] == "free"
    set_cookie = anon.post("/api/auth/login", json={"email": email, "password": PASSWORD}).headers["set-cookie"].lower()
    assert "hp_refresh=" in set_cookie and "httponly" in set_cookie and "samesite=lax" in set_cookie and "path=/api/auth" in set_cookie
    assert "refresh_token" not in str(data), "the refresh token must never appear in a JSON body (script-readable)"
    assert anon.get("/api/auth/me", headers={"Authorization": f"Bearer {data['access_token']}"}).json()["email"] == email


def test_signup_validation(anon):
    email, _ = signup(anon)
    dup = anon.post("/api/auth/signup", json={"email": email.upper(), "password": PASSWORD})
    assert dup.status_code == 409, "emails are case-insensitive"
    assert anon.post("/api/auth/signup", json={"email": "not-an-email", "password": PASSWORD}).status_code == 422
    assert anon.post("/api/auth/signup", json={"email": "a@b.co", "password": "short"}).status_code == 422
    assert anon.post("/api/auth/signup", json={"email": "c@d.co", "password": "password123"}).status_code == 422
    assert anon.post("/api/auth/signup", json={"email": "bobby@d.co", "password": "bobby-bobby-bobby"}).status_code == 422, "no email in the password"


def test_login_is_generic_and_throttled(anon):
    email, _ = signup(anon)
    ok = anon.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert ok.status_code == 200 and "access_token" in ok.json()
    wrong = anon.post("/api/auth/login", json={"email": email, "password": "wrong-password-here"})
    ghost = anon.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-here"})
    assert wrong.status_code == ghost.status_code == 401 and wrong.json() == ghost.json(), "a missing user must look exactly like a wrong password"
    codes = [anon.post("/api/auth/login", json={"email": email, "password": f"guess-number-{i}-xx"}).status_code for i in range(10)]
    assert 429 in codes, "brute force must be throttled"
    locked = anon.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert locked.status_code == 429 and "retry-after" in locked.headers


# ---------------- access tokens ----------------
def test_protected_routes_require_a_valid_token(anon):
    for method, path in (("get", "/api/resumes"), ("get", "/api/jobs"), ("get", "/api/tasks"), ("get", "/api/profile"), ("get", "/api/preferences"),
                         ("get", "/api/settings"), ("get", "/api/export"), ("get", "/api/auth/me"), ("get", "/api/jobs/companies")):
        assert getattr(anon, method)(path).status_code == 401, path
    assert anon.get("/api/health").status_code == 200
    assert anon.get("/api/auth/providers").status_code == 200
    assert anon.get("/api/resumes", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_expired_forged_and_wrong_type_tokens_are_rejected(anon):
    _, data = signup(anon)
    uid = data["user"]["id"]
    base = {"sub": str(uid), "tid": 1, "role": "owner", "ver": 0, "typ": "access"}
    expired = jwt.encode({**base, "exp": int(time.time()) - 5}, settings.secret_key, algorithm="HS256")
    forged = jwt.encode({**base, "exp": int(time.time()) + 600}, "some-other-secret-that-is-long-enough-xx", algorithm="HS256")
    refresh_typed = jwt.encode({**base, "typ": "refresh", "exp": int(time.time()) + 600}, settings.secret_key, algorithm="HS256")
    none_alg = jwt.encode({**base, "exp": int(time.time()) + 600}, "", algorithm="none")
    for tok in (expired, forged, refresh_typed, none_alg):
        assert anon.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401
    assert anon.get("/api/auth/me", headers={"Authorization": f"Bearer {data['access_token']}"}).status_code == 200


# ---------------- refresh rotation ----------------
def test_refresh_rotates_the_token_and_issues_a_working_access_token(anon):
    _, data = signup(anon)
    a = anon.cookies.get("hp_refresh")
    r = anon.post("/api/auth/refresh")
    assert r.status_code == 200
    b = anon.cookies.get("hp_refresh")
    assert a and b and a != b, "every refresh must hand out a new refresh token"
    assert anon.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).status_code == 200


def test_reusing_a_rotated_refresh_token_revokes_the_whole_session(anon, monkeypatch):
    monkeypatch.setattr(security, "GRACE_SECONDS", 0)  # no grace: any reuse is theft
    _, _ = signup(anon)
    stolen = anon.cookies.get("hp_refresh")
    assert anon.post("/api/auth/refresh").status_code == 200  # the real user rotates it
    legit_new = anon.cookies.get("hp_refresh")
    time.sleep(0.05)
    anon.cookies.clear()
    replay = anon.post("/api/auth/refresh", headers={"Cookie": f"hp_refresh={stolen}"})
    assert replay.status_code == 401, "the attacker replaying the old token is rejected"
    anon.cookies.clear()
    assert anon.post("/api/auth/refresh", headers={"Cookie": f"hp_refresh={legit_new}"}).status_code == 401, \
        "and the legitimate holder is cut off too: nobody can tell who is who, so the family dies"


def test_two_tabs_refreshing_at_once_do_not_log_you_out(anon, monkeypatch):
    monkeypatch.setattr(security, "GRACE_SECONDS", 30)
    signup(anon)
    shared = anon.cookies.get("hp_refresh")
    first = anon.post("/api/auth/refresh")
    anon.cookies.clear()
    second = anon.post("/api/auth/refresh", headers={"Cookie": f"hp_refresh={shared}"})  # the other tab, same cookie
    assert first.status_code == 200 and second.status_code == 200


def test_refresh_requires_the_cookie_and_our_origin(anon):
    signup(anon)
    assert anon.post("/api/auth/refresh", headers={"Origin": "https://evil.example"}).status_code == 403
    anon.cookies.clear()
    assert anon.post("/api/auth/refresh").status_code == 401
    assert anon.post("/api/auth/refresh", headers={"Cookie": "hp_refresh=not-a-real-token"}).status_code == 401


def test_logout_revokes_the_session(anon):
    signup(anon)
    cookie = anon.cookies.get("hp_refresh")
    assert anon.post("/api/auth/logout").status_code == 204
    anon.cookies.clear()
    assert anon.post("/api/auth/refresh", headers={"Cookie": f"hp_refresh={cookie}"}).status_code == 401


def test_logout_everywhere_kills_access_tokens_immediately(anon):
    _, data = signup(anon)
    h = {"Authorization": f"Bearer {data['access_token']}"}
    assert anon.get("/api/resumes", headers=h).status_code == 200
    assert anon.post("/api/auth/logout-all", headers=h).status_code == 204
    assert anon.get("/api/resumes", headers=h).status_code == 401, "a still-unexpired access token must stop working at once"


# ---------------- sessions ----------------
def test_sessions_list_and_revoke_only_your_own(make_user):
    a, b = make_user(), make_user()
    other_login = a.post("/api/auth/login", json={"email": a.email, "password": PASSWORD})
    assert other_login.status_code == 200
    sessions = a.get("/api/auth/sessions").json()
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) >= 1
    victim = next(s for s in b.get("/api/auth/sessions").json())
    a.delete(f"/api/auth/sessions/{victim['id']}")  # someone else's session: silently ignored
    assert len(b.get("/api/auth/sessions").json()) == 1
    not_current = next(s for s in sessions if not s["current"])
    assert a.delete(f"/api/auth/sessions/{not_current['id']}").status_code == 204
    assert len(a.get("/api/auth/sessions").json()) == 1


# ---------------- passwords ----------------
def test_password_change_ends_other_sessions(anon):
    email, data = signup(anon)
    old_access = {"Authorization": f"Bearer {data['access_token']}"}
    bad = anon.post("/api/auth/password/change", headers=old_access, json={"current_password": "not-my-password", "new_password": "a brand new passphrase"})
    assert bad.status_code == 400
    ok = anon.post("/api/auth/password/change", headers=old_access, json={"current_password": PASSWORD, "new_password": "a brand new passphrase"})
    assert ok.status_code == 200
    assert anon.get("/api/resumes", headers=old_access).status_code == 401, "tokens from before the change are dead"
    assert anon.get("/api/resumes", headers={"Authorization": f"Bearer {ok.json()['access_token']}"}).status_code == 200, "this device stays signed in"
    anon.cookies.clear()
    assert anon.post("/api/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401
    assert anon.post("/api/auth/login", json={"email": email, "password": "a brand new passphrase"}).status_code == 200


def test_password_reset_flow(anon, monkeypatch):
    sent = []
    monkeypatch.setattr("app.routers.auth.mailer.send", lambda to, subject, body: sent.append((to, body)))
    email, data = signup(anon)
    ghost = anon.post("/api/auth/password/forgot", json={"email": "nobody@example.com"})
    real = anon.post("/api/auth/password/forgot", json={"email": email})
    assert ghost.status_code == real.status_code == 202 and ghost.json() == real.json(), "must not reveal which emails have accounts"
    assert len(sent) == 1 and sent[0][0] == email
    token = sent[0][1].split("token=")[1].split()[0]
    assert anon.post("/api/auth/password/reset", json={"token": token, "password": "short"}).status_code == 422
    assert anon.post("/api/auth/password/reset", json={"token": token, "password": "a fresh reset passphrase"}).status_code == 204
    assert anon.post("/api/auth/password/reset", json={"token": token, "password": "another reset passphrase"}).status_code == 400, "single use"
    assert anon.post("/api/auth/password/reset", json={"token": "nonsense", "password": "a fresh reset passphrase"}).status_code == 400
    assert anon.get("/api/resumes", headers={"Authorization": f"Bearer {data['access_token']}"}).status_code == 401, "reset signs everyone out"
    assert anon.post("/api/auth/login", json={"email": email, "password": "a fresh reset passphrase"}).status_code == 200


def test_expired_reset_links_are_refused(anon, monkeypatch):
    from datetime import timedelta

    from app.db import SessionLocal
    from app.models import AuthToken

    sent = []
    monkeypatch.setattr("app.routers.auth.mailer.send", lambda to, subject, body: sent.append(body))
    email, _ = signup(anon)
    anon.post("/api/auth/password/forgot", json={"email": email})
    token = sent[0].split("token=")[1].split()[0]
    with SessionLocal() as db:
        row = db.query(AuthToken).filter(AuthToken.token_hash == security.sha256(token)).one()
        row.expires_at = security.now() - timedelta(minutes=1)
        db.commit()
    assert anon.post("/api/auth/password/reset", json={"token": token, "password": "a fresh reset passphrase"}).status_code == 400


# ---------------- isolation: the property that matters most ----------------
def test_users_cannot_see_or_touch_each_others_resumes(make_user):
    a, b = make_user(), make_user()
    rid = a.post("/api/resumes", json={"name": "A's private resume", "latex": LATEX}).json()["id"]
    vid = a.post(f"/api/resumes/{rid}/versions", json={"latex": LATEX, "label": "A's version"}).json()["id"]
    assert b.get("/api/resumes").json() == [] and [r["id"] for r in a.get("/api/resumes").json()] == [rid]
    for method, path, body in (("get", f"/api/resumes/{rid}", None), ("put", f"/api/resumes/{rid}", {"name": "pwned"}), ("delete", f"/api/resumes/{rid}", None),
                               ("get", f"/api/resumes/{rid}/export?format=tex", None), ("get", f"/api/resumes/{rid}/versions", None),
                               ("post", f"/api/resumes/{rid}/versions", {"latex": LATEX, "label": "x"}), ("delete", f"/api/resumes/{rid}/versions/{vid}", None),
                               ("get", f"/api/resumes/{rid}/versions/{vid}/export?format=tex", None),
                               ("post", f"/api/resumes/{rid}/tailor", {"job_description": "x"}), ("post", f"/api/resumes/{rid}/ats", {"job_description": "x" * 30})):
        r = getattr(b, method)(path, **({"json": body} if body is not None else {}))
        assert r.status_code == 404, f"{method.upper()} {path} leaked: {r.status_code}"
    assert a.get(f"/api/resumes/{rid}").json()["name"] == "A's private resume", "and nothing was changed"
    assert len(a.get(f"/api/resumes/{rid}/versions").json()) == 1


def test_users_cannot_see_each_others_tasks_or_start_tasks_on_them(make_user, monkeypatch):
    from app.schemas import TailorResult
    from app.services import tasks as task_service

    async def fake(db, latex, jd, company, title, extra, opts, on_progress):
        return TailorResult(latex=latex, changes=["x"])

    monkeypatch.setattr(task_service, "tailor_resume", fake)
    a, b = make_user(), make_user()
    rid = a.post("/api/resumes", json={"name": "r", "latex": LATEX}).json()["id"]
    tid = a.post("/api/tasks", json={"kind": "tailor", "resume_id": rid, "payload": {"job_description": "jd"}}).json()["id"]
    assert b.post("/api/tasks", json={"kind": "tailor", "resume_id": rid, "payload": {"job_description": "jd"}}).status_code == 404
    assert b.get(f"/api/tasks/{tid}").status_code == 404 and b.get("/api/tasks").json() == []
    b.delete(f"/api/tasks/{tid}")
    assert a.get(f"/api/tasks/{tid}").status_code == 200, "B could not delete A's task"


def test_job_state_is_private_but_the_catalog_is_shared(make_user):
    from test_api import _add_job

    a, b = make_user(), make_user()
    tag = uuid.uuid4().hex[:8]
    jid = _add_job(title=f"Shared role {tag}")
    assert a.patch(f"/api/jobs/{jid}", json={"status": "applied"}).json()["status"] == "applied"
    seen_by_b = next(j for j in b.get(f"/api/jobs?q=Shared role {tag}").json() if j["id"] == jid)
    assert seen_by_b["status"] == "new", "B must not inherit A's status"
    assert next(j for j in a.get(f"/api/jobs?q=Shared role {tag}").json() if j["id"] == jid)["status"] == "applied"
    b.patch(f"/api/jobs/{jid}", json={"status": "ignored"})
    assert not [j for j in b.get(f"/api/jobs?q=Shared role {tag}").json() if j["id"] == jid], "B's ignore hides it from B only"
    assert [j for j in a.get(f"/api/jobs?q=Shared role {tag}").json() if j["id"] == jid]
    assert b.get(f"/api/jobs/{jid}").json()["status"] == "ignored" and a.get(f"/api/jobs/{jid}").json()["status"] == "applied"


def test_score_cannot_use_someone_elses_resume(make_user):
    a, b = make_user(), make_user()
    rid = a.post("/api/resumes", json={"name": "r", "latex": LATEX}).json()["id"]
    assert b.post("/api/jobs/score", json={"resume_id": rid, "limit": 1}).status_code == 404
    assert b.post("/api/jobs/1/apply-kit", json={"resume_id": rid}).status_code == 404


def test_profile_preferences_and_the_openai_key_are_per_user(make_user):
    a, b = make_user(), make_user()
    a.put("/api/profile", json={"full_name": "Alice", "email": "alice@example.com"})
    assert b.get("/api/profile").json()["full_name"] == ""
    prefs = a.get("/api/preferences").json()
    a.put("/api/preferences", json={**prefs, "theme": "dark", "accent": "rose"})
    assert b.get("/api/preferences").json()["theme"] == "system"
    a.put("/api/settings", json={"openai_api_key": "sk-test-alice-1234", "openai_model": "gpt-4o-mini"})
    assert a.get("/api/settings").json()["openai_configured"] is True
    sb = b.get("/api/settings").json()
    assert sb["openai_configured"] is False and sb["openai_model"] != "gpt-4o-mini", "Bob must not be able to spend Alice's OpenAI key"
    export = a.get("/api/export").text
    assert "alice@example.com" in export and "sk-test" not in export
    assert "alice@example.com" not in b.get("/api/export").text


# ---------------- first account claims data from before accounts existed ----------------
def test_the_first_account_claims_pre_accounts_data(anon, monkeypatch):
    from app.db import SessionLocal
    from app.models import AppSetting, Job, Resume, UserJob
    from app.services import accounts, settings_store

    _, data = signup(anon)
    uid = data["user"]["id"]
    with SessionLocal() as db:
        legacy = Resume(name="Legacy resume", latex=LATEX)  # user_id left null, like data created before accounts
        job = Job(source="t", external_id=uuid.uuid4().hex, company="Acme", title="Legacy role", location="x", url="https://x", status="applied", score=77, level_tag="junior")
        db.add_all([legacy, job])
        db.commit()
        db.add(AppSetting(key="applicant_profile", value='{"full_name":"Legacy Person"}'))
        db.add(AppSetting(key="openai_model", value="gpt-4o-mini"))
        db.merge(AppSetting(key="legacy_claimed", value=""))
        db.commit()
        db.delete(db.get(AppSetting, "legacy_claimed"))  # as if this were the very first account
        db.commit()
        user = db.get(accounts.User, uid)
        monkeypatch.setattr(settings, "claim_legacy_email", user.email)  # many users exist in the test DB, so name the claimant
        assert accounts.claim_legacy_data(db, user) is True
    with SessionLocal() as db:  # a fresh session: what is really in the database, not this session's cache
        user = db.get(accounts.User, uid)
        assert db.get(Resume, legacy.id).user_id == uid and db.get(Resume, legacy.id).tenant_id == user.tenant_id
        uj = db.get(UserJob, (uid, job.id))
        assert uj and uj.status == "applied" and uj.score == 77
        assert settings_store.get_value(db, "applicant_profile", uid) == '{"full_name":"Legacy Person"}'
        assert db.get(AppSetting, "applicant_profile") is None, "the global copy is removed so nobody else can read it"
        assert accounts.claim_legacy_data(db, user) is False, "claiming happens once"
        db.delete(db.get(UserJob, (uid, job.id)))
        db.delete(db.get(Resume, legacy.id))
        db.delete(db.get(Job, job.id))
        db.commit()


# ---------------- OAuth ----------------
@pytest.fixture()
def oauth_on(monkeypatch):
    for k, v in (("google_client_id", "gid"), ("google_client_secret", "gsecret"), ("github_client_id", "hid"), ("github_client_secret", "hsecret")):
        monkeypatch.setattr(settings, k, v)
    monkeypatch.setattr(settings, "public_base_url", "http://localhost:3000")


def test_providers_reflect_configuration(anon, monkeypatch):
    for k in ("google_client_id", "github_client_id", "apple_client_id"):
        monkeypatch.setattr(settings, k, "")
    assert anon.get("/api/auth/providers").json() == {"password": True, "signup_open": True, "google": False, "github": False, "apple": False}
    r = anon.get("/api/auth/oauth/google/start", follow_redirects=False)
    assert r.status_code == 302 and "/login?error=" in r.headers["location"], "an unconfigured provider fails politely"


def test_oauth_start_sets_a_signed_state_cookie_and_pkce(anon, oauth_on):
    from urllib.parse import parse_qs, urlparse

    r = anon.get("/api/auth/oauth/google/start?next=/jobs", follow_redirects=False)
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert urlparse(r.headers["location"]).netloc == "accounts.google.com"
    assert q["client_id"] == ["gid"] and q["redirect_uri"] == ["http://localhost:3000/api/auth/oauth/google/callback"]
    assert q["code_challenge_method"] == ["S256"] and q["code_challenge"] and q["state"]
    cookie = r.headers["set-cookie"].lower()
    assert "hp_oauth=" in cookie and "httponly" in cookie and "path=/api/auth/oauth" in cookie


def test_oauth_next_cannot_redirect_off_site():
    from app.services.oauth import safe_next

    for bad in ("//evil.example", "https://evil.example", "javascript:alert(1)", "/\\evil.example", "/ok\r\nSet-Cookie: x=1", None, ""):
        assert safe_next(bad) == "/", bad
    assert safe_next("/jobs?x=1") == "/jobs?x=1"


def _fake_profile(monkeypatch, **kw):
    from app.services import oauth

    async def fake(provider, code, verifier, apple_user=None):
        return oauth.ProviderProfile(**kw)

    monkeypatch.setattr(oauth, "fetch_profile", fake)


def _run_oauth(anon, provider="google"):
    start = anon.get(f"/api/auth/oauth/{provider}/start?next=/resumes", follow_redirects=False)
    from urllib.parse import parse_qs, urlparse

    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    return anon.get(f"/api/auth/oauth/{provider}/callback?code=abc&state={state}", follow_redirects=False), state


def test_oauth_signup_creates_a_verified_account_and_a_session(anon, oauth_on, monkeypatch):
    email = f"g-{uuid.uuid4().hex[:8]}@example.com"
    _fake_profile(monkeypatch, subject=f"sub-{uuid.uuid4().hex}", email=email, email_verified=True, name="Gina Google", avatar_url="https://img/x.png")
    r, _ = _run_oauth(anon)
    assert r.status_code == 302 and r.headers["location"] == "http://localhost:3000/auth/callback?next=%2Fresumes"
    assert "hp_refresh=" in r.headers["set-cookie"]
    token = anon.post("/api/auth/refresh").json()
    assert token["user"]["email"] == email and token["user"]["email_verified"] is True and token["user"]["has_password"] is False
    assert token["user"]["providers"] == ["google"] and token["user"]["tenant"]["name"].startswith("Gina Google")


def test_oauth_links_an_existing_account_only_when_the_email_is_verified(anon, oauth_on, monkeypatch):
    email, _ = signup(anon)
    anon.cookies.clear()
    _fake_profile(monkeypatch, subject=f"sub-{uuid.uuid4().hex}", email=email, email_verified=False, name="Attacker")
    r, _ = _run_oauth(anon)
    assert "/login?error=" in r.headers["location"], "an UNVERIFIED provider email must never be linked to an existing account"
    assert "hp_refresh" not in r.headers.get("set-cookie", "")
    sub = f"sub-{uuid.uuid4().hex}"
    _fake_profile(monkeypatch, subject=sub, email=email, email_verified=True, name="Real Owner")
    r, _ = _run_oauth(anon)
    assert r.headers["location"].startswith("http://localhost:3000/auth/callback")
    me = anon.post("/api/auth/refresh").json()["user"]
    assert me["email"] == email and me["has_password"] is True and me["providers"] == ["google"], "linked to the existing account, password intact"
    anon.cookies.clear()
    _fake_profile(monkeypatch, subject=sub, email="changed-address@example.com", email_verified=True, name="Real Owner")
    r, _ = _run_oauth(anon)
    assert anon.post("/api/auth/refresh").json()["user"]["email"] == email, "a returning identity maps to the same user even if the provider email changed"


def test_oauth_rejects_tampered_or_missing_state(anon, oauth_on, monkeypatch):
    _fake_profile(monkeypatch, subject="x", email="x@example.com", email_verified=True)
    start = anon.get("/api/auth/oauth/google/start", follow_redirects=False)
    bad = anon.get("/api/auth/oauth/google/callback?code=abc&state=forged-state", follow_redirects=False)
    assert "/login?error=" in bad.headers["location"] and "hp_refresh" not in bad.headers.get("set-cookie", "")
    anon.cookies.clear()
    no_cookie = anon.get("/api/auth/oauth/google/callback?code=abc&state=anything", follow_redirects=False)
    assert "/login?error=" in no_cookie.headers["location"], "a callback with no binding cookie (login CSRF) is refused"
    denied = anon.get("/api/auth/oauth/google/callback?error=access_denied", follow_redirects=False)
    assert "cancelled" in denied.headers["location"].lower()


def test_cannot_unlink_the_only_way_to_sign_in(anon, oauth_on, monkeypatch):
    _fake_profile(monkeypatch, subject=f"sub-{uuid.uuid4().hex}", email=f"o-{uuid.uuid4().hex[:8]}@example.com", email_verified=True, name="O")
    _run_oauth(anon)
    tok = anon.post("/api/auth/refresh").json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert anon.delete("/api/auth/oauth/google", headers=h).status_code == 400
    changed = anon.post("/api/auth/password/change", headers=h, json={"new_password": "now i have a password"})
    assert changed.status_code == 200
    h2 = {"Authorization": f"Bearer {changed.json()['access_token']}"}  # the old token died with the password change
    assert anon.delete("/api/auth/oauth/google", headers=h2).status_code == 204


# --- provider network calls, against a fake provider server ---
import httpx  # noqa: E402


def _install(monkeypatch, handler):
    from app.services import oauth

    monkeypatch.setattr(oauth, "client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler), headers={"Accept": "application/json"}))
    return oauth


def test_google_exchange_sends_pkce_and_reads_userinfo(oauth_on, monkeypatch):
    import asyncio

    seen = {}

    def handler(req: httpx.Request):
        if req.url.host == "oauth2.googleapis.com":
            seen["token_form"] = dict(httpx.QueryParams(req.content.decode()))
            return httpx.Response(200, json={"access_token": "AT"})
        assert req.headers["authorization"] == "Bearer AT"
        return httpx.Response(200, json={"sub": "g-1", "email": "g@example.com", "email_verified": True, "name": "G", "picture": "https://p"})

    oauth = _install(monkeypatch, handler)
    p = asyncio.run(oauth.fetch_profile("google", "the-code", "the-verifier"))
    assert (p.subject, p.email, p.email_verified) == ("g-1", "g@example.com", True)
    assert seen["token_form"]["code_verifier"] == "the-verifier" and seen["token_form"]["grant_type"] == "authorization_code"


def test_github_uses_the_verified_primary_email_never_the_profile_email(oauth_on, monkeypatch):
    import asyncio

    def handler(req: httpx.Request):
        if req.url.path == "/login/oauth/access_token":
            return httpx.Response(200, json={"access_token": "AT"})
        if req.url.path == "/user":
            return httpx.Response(200, json={"id": 99, "login": "octo", "name": "Octo", "avatar_url": "https://a", "email": "public-unverified@example.com"})
        return httpx.Response(200, json=[{"email": "spoof@example.com", "primary": False, "verified": False},
                                        {"email": "real@example.com", "primary": True, "verified": True}])

    p = asyncio.run(_install(monkeypatch, handler).fetch_profile("github", "c", ""))
    assert (p.subject, p.email, p.email_verified) == ("99", "real@example.com", True)

    def only_unverified(req: httpx.Request):
        if req.url.path == "/login/oauth/access_token":
            return httpx.Response(200, json={"access_token": "AT"})
        if req.url.path == "/user":
            return httpx.Response(200, json={"id": 5, "login": "x", "email": "claimed@example.com"})
        return httpx.Response(200, json=[{"email": "claimed@example.com", "primary": True, "verified": False}])

    q = asyncio.run(_install(monkeypatch, only_unverified).fetch_profile("github", "c", ""))
    assert q.email is None and q.email_verified is False, "an unverified GitHub email is treated as no email at all"


def test_apple_verifies_the_id_token_signature_audience_and_issuer(monkeypatch):
    import asyncio
    import json

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec, rsa

    ec_pem = ec.generate_private_key(ec.SECP256R1()).private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(rsa_key.public_key())) | {"kid": "k1", "alg": "RS256", "use": "sig"}
    for k, v in (("apple_client_id", "com.example.web"), ("apple_team_id", "TEAM123456"), ("apple_key_id", "KEY1234567"), ("apple_private_key", ec_pem)):
        monkeypatch.setattr(settings, k, v)
    monkeypatch.setattr(settings, "public_base_url", "http://localhost:3000")

    def make(**over):
        claims = {"iss": "https://appleid.apple.com", "aud": "com.example.web", "sub": "apple-1", "email": "a@privaterelay.appleid.com",
                  "email_verified": "true", "exp": int(time.time()) + 300, "iat": int(time.time())} | over
        return jwt.encode(claims, rsa_key, algorithm="RS256", headers={"kid": "k1"})

    def server(id_token):
        def handler(req: httpx.Request):
            if req.url.path == "/auth/token":
                form = dict(httpx.QueryParams(req.content.decode()))
                assert jwt.get_unverified_header(form["client_secret"])["kid"] == "KEY1234567", "client secret is an ES256 JWT signed with our key id"
                return httpx.Response(200, json={"id_token": id_token})
            return httpx.Response(200, json={"keys": [jwk]})
        return handler

    p = asyncio.run(_install(monkeypatch, server(make())).fetch_profile("apple", "c", "", {"name": {"firstName": "Ann", "lastName": "Apple"}}))
    assert (p.subject, p.email_verified, p.name) == ("apple-1", True, "Ann Apple")
    from app.services.security import AuthError

    for bad in (make(aud="someone.else"), make(iss="https://evil.example"), make(exp=int(time.time()) - 60)):
        with pytest.raises(AuthError):
            asyncio.run(_install(monkeypatch, server(bad)).fetch_profile("apple", "c", ""))
    wrong_key = jwt.encode({"iss": "https://appleid.apple.com", "aud": "com.example.web", "sub": "x", "exp": int(time.time()) + 300},
                           rsa.generate_private_key(public_exponent=65537, key_size=2048), algorithm="RS256", headers={"kid": "k1"})
    with pytest.raises(AuthError):
        asyncio.run(_install(monkeypatch, server(wrong_key)).fetch_profile("apple", "c", ""))


def test_job_id_references_are_scrubbed_from_ai_text():
    from app.services.hiring import scrub

    assert scrub("Similar to job id 42, good backend skills but lacks specific AI collaboration experience.") == "Good backend skills but lacks specific AI collaboration experience."
    assert scrub("Strong Java skills (see posting 17) but no Kafka.") == "Strong Java skills but no Kafka."
    assert scrub("Matches [id=88] closely on stack.") == "Matches closely on stack."
    assert scrub("Solid fundamentals; lacks cloud depth.") == "Solid fundamentals; lacks cloud depth."
    assert scrub(None) == "" and scrub("") == ""


def test_only_the_named_email_may_claim_legacy_data(anon, monkeypatch):
    from app.db import SessionLocal
    from app.models import AppSetting, Resume
    from app.services import accounts

    owner_email = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    monkeypatch.setattr(settings, "claim_legacy_email", owner_email)
    with SessionLocal() as db:
        marker = db.get(AppSetting, "legacy_claimed")
        if marker:
            db.delete(marker)
            db.commit()
        legacy = Resume(name="Legacy", latex=LATEX)
        db.add(legacy)
        db.commit()
        lid = legacy.id
    signup(anon)  # a stranger registers first
    with SessionLocal() as db:
        assert db.get(Resume, lid).user_id is None, "a stranger must not be able to claim the old data by registering first"
    anon.cookies.clear()
    _, data = signup(anon, email=owner_email)
    with SessionLocal() as db:
        assert db.get(Resume, lid).user_id == data["user"]["id"], "the named owner gets it, even though they signed up later"
        db.delete(db.get(Resume, lid))
        db.commit()


def test_platform_admin_follows_admin_emails(anon, monkeypatch):
    boss = f"boss-{uuid.uuid4().hex[:8]}@example.com"
    monkeypatch.setattr(settings, "admin_emails", boss)
    _, plain = signup(anon)
    anon.cookies.clear()
    _, admin = signup(anon, email=boss)
    assert plain["user"]["is_platform_admin"] is False and admin["user"]["is_platform_admin"] is True
