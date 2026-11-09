"""Sign-up, sign-in, sessions, password reset and OAuth. Everything here is public except where `current_user` is required."""
from datetime import timedelta
from typing import Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, Cookie, Depends, Form, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import check_origin, current_user
from ..models import AuthToken, OAuthIdentity, RefreshToken, User
from ..services import accounts, mailer, oauth, ratelimit, security
from ..services.security import AuthError, now

router = APIRouter(prefix="/auth", tags=["auth"])
REFRESH_COOKIE = "hp_refresh"
_DUMMY: Optional[str] = None


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


def _set_refresh(resp: Response, raw: str) -> None:
    resp.set_cookie(REFRESH_COOKIE, raw, max_age=settings.refresh_token_days * 86400, httponly=True,
                    secure=settings.cookie_secure, samesite="lax", path="/api/auth")


def _clear_refresh(resp: Response) -> None:
    resp.delete_cookie(REFRESH_COOKIE, path="/api/auth")


def _fail(message: str, status: int, clear: bool = False, retry_after: int = 0) -> JSONResponse:
    resp = JSONResponse(status_code=status, content={"detail": message})
    if clear:
        _clear_refresh(resp)
    if retry_after:
        resp.headers["Retry-After"] = str(retry_after)
    return resp


def _session(db: Session, user: User, request: Request, response: Response, family_id: Optional[str] = None) -> dict[str, Any]:
    raw, _ = security.issue_refresh(db, user, family_id, request.headers.get("user-agent", ""), _ip(request))
    _set_refresh(response, raw)
    token, ttl = security.make_access_token(user)
    return {"access_token": token, "token_type": "bearer", "expires_in": ttl, "user": accounts.me_payload(db, user)}


def _public_error(message: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/login?error={quote(message)}"


# ---------- discovery ----------
@router.get("/providers")
def providers():
    return {"password": True, "signup_open": settings.signup_open, **oauth.enabled()}


# ---------- email + password ----------
class SignupBody(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=300)
    name: str = Field(default="", max_length=120)


class LoginBody(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=300)


@router.post("/signup", status_code=201)
def signup(body: SignupBody, request: Request, response: Response, db: Session = Depends(get_db)):
    if not settings.signup_open:
        return _fail("Sign-ups are closed.", 403)
    ok, wait = ratelimit.hit(f"signup:{_ip(request)}", 10, 3600)
    if not ok:
        return _fail("Too many sign-ups from this network. Try again later.", 429, retry_after=wait)
    email = accounts.normalize_email(body.email)
    if not accounts.valid_email(email):
        return _fail("Enter a valid email address.", 422)
    try:
        security.validate_password(body.password, email)
    except AuthError as e:
        return _fail(e.message, e.status)
    if db.scalar(select(User.id).where(User.email == email)):
        return _fail("An account with this email already exists. Sign in instead.", 409)
    user = accounts.create_account(db, email, body.name, security.hash_password(body.password), email_verified=False)
    accounts.touch_login(db, user)
    return _session(db, user, request, response)


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    global _DUMMY
    email = accounts.normalize_email(body.email)
    ip = _ip(request)
    ok1, wait1 = ratelimit.hit(f"login:{ip}:{email}", 8, 900)  # 8 tries per address per network per 15 min
    ok2, wait2 = ratelimit.hit(f"login-ip:{ip}", 60, 900)
    if not (ok1 and ok2):
        return _fail("Too many attempts. Try again in a few minutes.", 429, retry_after=max(wait1, wait2))
    user = db.scalar(select(User).where(User.email == email))
    if _DUMMY is None:
        _DUMMY = security.hash_password("timing-equaliser-not-a-real-password")
    valid = security.verify_password(user.password_hash if user else _DUMMY, body.password)  # same work whether or not the user exists
    if not user or not valid or not user.is_active:
        return _fail("Incorrect email or password. If you signed up with Google, GitHub or Apple, use that button instead.", 401)
    ratelimit.reset(f"login:{ip}:{email}")
    accounts.touch_login(db, user)
    return _session(db, user, request, response)


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db), hp_refresh: Optional[str] = Cookie(default=None)):
    check_origin(request)
    if not hp_refresh:
        return _fail("Not signed in", 401)
    try:
        user, raw, row = security.rotate_refresh(db, hp_refresh, request.headers.get("user-agent", ""), _ip(request))
    except AuthError as e:
        return _fail(e.message, e.status, clear=True)
    _set_refresh(response, raw)
    token, ttl = security.make_access_token(user)
    return {"access_token": token, "token_type": "bearer", "expires_in": ttl, "user": accounts.me_payload(db, user)}


@router.post("/logout", status_code=204)
def logout(request: Request, db: Session = Depends(get_db), hp_refresh: Optional[str] = Cookie(default=None)):
    check_origin(request)
    resp = Response(status_code=204)
    if hp_refresh:
        row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == security.sha256(hp_refresh)))
        if row:
            security.revoke_family(db, row.family_id)
    _clear_refresh(resp)
    return resp


# ---------- the signed-in user ----------
@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return accounts.me_payload(db, user)


class ProfilePatch(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.patch("/me")
def update_me(body: ProfilePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.name = body.name.strip()
    db.commit()
    return accounts.me_payload(db, user)


@router.get("/sessions")
def sessions(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db), hp_refresh: Optional[str] = Cookie(default=None)):
    rows = db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).order_by(RefreshToken.created_at)).all()
    current_family = None
    if hp_refresh:
        cur = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == security.sha256(hp_refresh)))
        current_family = cur.family_id if cur else None
    fams: dict[str, dict[str, Any]] = {}
    for r in rows:
        if security._aware(r.expires_at) <= now():
            continue
        f = fams.setdefault(r.family_id, {"id": r.family_id, "started_at": r.created_at, "last_active": r.created_at, "user_agent": r.user_agent, "ip": r.ip,
                                          "current": r.family_id == current_family})
        f["last_active"], f["user_agent"], f["ip"] = max(f["last_active"], r.created_at), r.user_agent, r.ip
    return sorted(fams.values(), key=lambda f: f["last_active"], reverse=True)


@router.delete("/sessions/{family_id}", status_code=204)
def revoke_session(family_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(RefreshToken).where(RefreshToken.family_id == family_id, RefreshToken.user_id == user.id))
    if row:  # only ever your own sessions
        security.revoke_family(db, family_id)


@router.post("/logout-all", status_code=204)
def logout_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.token_version += 1  # every access token dies now, not in 15 minutes
    db.commit()
    security.revoke_all(db, user.id)
    resp = Response(status_code=204)
    _clear_refresh(resp)
    return resp


class ChangePassword(BaseModel):
    current_password: str = Field(default="", max_length=300)
    new_password: str = Field(max_length=300)


@router.post("/password/change")
def change_password(body: ChangePassword, request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ok, wait = ratelimit.hit(f"pwchange:{user.id}", 6, 900)
    if not ok:
        return _fail("Too many attempts. Try again in a few minutes.", 429, retry_after=wait)
    if user.password_hash and not security.verify_password(user.password_hash, body.current_password):
        return _fail("Your current password is incorrect.", 400)
    try:
        security.validate_password(body.new_password, user.email)
    except AuthError as e:
        return _fail(e.message, e.status)
    user.password_hash = security.hash_password(body.new_password)
    user.token_version += 1  # ends every other device's session; this one gets a fresh session below
    db.commit()
    security.revoke_all(db, user.id)
    return _session(db, user, request, response)


@router.delete("/oauth/{provider}", status_code=204)
def unlink(provider: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    idents = db.scalars(select(OAuthIdentity).where(OAuthIdentity.user_id == user.id)).all()
    target = [i for i in idents if i.provider == provider]
    if not target:
        return
    if not user.password_hash and len(idents) - len(target) < 1:
        raise AuthError("Add a password or another sign-in method first, or you would be locked out.", 400)
    for i in target:
        db.delete(i)
    db.commit()


# ---------- password reset ----------
class ForgotBody(BaseModel):
    email: str = Field(max_length=320)


@router.post("/password/forgot", status_code=202)
def forgot(body: ForgotBody, request: Request, db: Session = Depends(get_db)):
    ok, _ = ratelimit.hit(f"forgot:{_ip(request)}", 6, 3600)
    email = accounts.normalize_email(body.email)
    user = db.scalar(select(User).where(User.email == email)) if ok else None
    if user and user.is_active:
        raw, digest = security.new_url_token()
        db.add(AuthToken(id=raw[:16] + digest[:16], user_id=user.id, kind="reset", token_hash=digest, expires_at=now() + timedelta(hours=1)))
        db.commit()
        mailer.send(user.email, "Reset your HirePilot password",
                    f"Use this link within one hour to choose a new password:\n\n{settings.public_base_url.rstrip('/')}/reset?token={raw}\n\n"
                    "If you did not ask for this, you can ignore this email.")
    return {"detail": "If that address has an account, we have sent a reset link."}  # same answer either way


class ResetBody(BaseModel):
    token: str = Field(max_length=200)
    password: str = Field(max_length=300)


@router.post("/password/reset", status_code=204)
def reset(body: ResetBody, request: Request, db: Session = Depends(get_db)):
    ok, wait = ratelimit.hit(f"reset:{_ip(request)}", 20, 3600)
    if not ok:
        return _fail("Too many attempts. Try again later.", 429, retry_after=wait)
    tok = db.scalar(select(AuthToken).where(AuthToken.token_hash == security.sha256(body.token), AuthToken.kind == "reset"))
    if not tok or tok.used_at is not None or security._aware(tok.expires_at) <= now():
        return _fail("This reset link is invalid or has expired. Request a new one.", 400)
    user = db.get(User, tok.user_id)
    if not user:
        return _fail("This reset link is invalid or has expired. Request a new one.", 400)
    try:
        security.validate_password(body.password, user.email)
    except AuthError as e:
        return _fail(e.message, e.status)
    user.password_hash = security.hash_password(body.password)
    user.token_version += 1
    tok.used_at = now()
    db.commit()
    security.revoke_all(db, user.id)
    return Response(status_code=204)


# ---------- OAuth ----------
@router.get("/oauth/{provider}/start")
def oauth_start(provider: str, next: Optional[str] = "/"):
    try:
        url, cookie = oauth.start(provider, next)
    except AuthError as e:
        return RedirectResponse(_public_error(e.message), status_code=302)
    resp = RedirectResponse(url, status_code=302)
    apple = provider == "apple"  # Apple posts back cross-site, so its binding cookie must be SameSite=None (and Secure)
    resp.set_cookie(oauth.COOKIE, cookie, max_age=oauth.STATE_TTL, httponly=True, secure=settings.cookie_secure or apple,
                    samesite="none" if apple else "lax", path="/api/auth/oauth")
    return resp


async def _finish(provider: str, request: Request, db: Session, code: Optional[str], state: Optional[str], error: Optional[str], apple_user: Optional[dict] = None):
    def bail(msg: str):
        r = RedirectResponse(_public_error(msg), status_code=302)
        r.delete_cookie(oauth.COOKIE, path="/api/auth/oauth")
        return r

    if error:
        return bail("Sign-in was cancelled." if error == "access_denied" else "The provider reported an error. Please try again.")
    try:
        data = oauth.verify_state(provider, request.cookies.get(oauth.COOKIE), state)
        if not code:
            raise AuthError("The provider did not return a sign-in code.", 400)
        profile = await oauth.fetch_profile(provider, code, data.get("verifier", ""), apple_user)
        user, _created = await run_in_threadpool(accounts.resolve_oauth, db, provider, profile.subject, profile.email, profile.email_verified, profile.name, profile.avatar_url)
        raw, _ = await run_in_threadpool(security.issue_refresh, db, user, None, request.headers.get("user-agent", ""), _ip(request))
        await run_in_threadpool(accounts.touch_login, db, user)
    except AuthError as e:
        return bail(e.message)
    resp = RedirectResponse(f"{settings.public_base_url.rstrip('/')}/auth/callback?next={quote(data.get('next', '/'), safe='')}", status_code=302)
    _set_refresh(resp, raw)
    resp.delete_cookie(oauth.COOKIE, path="/api/auth/oauth")
    return resp


@router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: str, request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None, db: Session = Depends(get_db)):
    if provider not in ("google", "github"):
        return RedirectResponse(_public_error("Unknown provider."), status_code=302)
    return await _finish(provider, request, db, code, state, error)


@router.post("/oauth/apple/callback")
async def apple_callback(request: Request, code: Optional[str] = Form(default=None), state: Optional[str] = Form(default=None),
                         error: Optional[str] = Form(default=None), user: Optional[str] = Form(default=None), db: Session = Depends(get_db)):
    import json

    try:
        apple_user = json.loads(user) if user else None
    except ValueError:
        apple_user = None
    return await _finish("apple", request, db, code, state, error, apple_user)
