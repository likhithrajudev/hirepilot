from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Tenant, User
from .services import context
from .services.security import AuthError, decode_access_token

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(msg: str) -> HTTPException:
    return HTTPException(401, msg, headers={"WWW-Authenticate": "Bearer"})


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer), db: Session = Depends(get_db)) -> User:
    """Authenticates the request and records the user for services that read the request context.

    This is async on purpose: a ContextVar set inside a sync dependency lives in a worker thread's copy of the context
    and would never reach the endpoint. Setting it here means every endpoint (and every background task it starts) sees it."""
    if not creds:
        raise _unauthorized("Not signed in")
    try:
        claims = decode_access_token(creds.credentials)
    except AuthError as e:
        raise _unauthorized(e.message)
    user = await run_in_threadpool(db.get, User, int(claims["sub"]))
    if not user or not user.is_active:
        raise _unauthorized("Account not found or disabled")
    if claims.get("ver") != user.token_version:  # password changed or "sign out everywhere": old tokens die immediately
        raise _unauthorized("Session expired")
    tenant = await run_in_threadpool(db.get, Tenant, user.tenant_id)
    if tenant is not None and tenant.status != "active":
        raise HTTPException(403, "This workspace is suspended. Contact support.")
    context.current_user_id.set(user.id)
    return user


async def platform_admin(user: User = Depends(current_user)) -> User:
    if not user.is_platform_admin:
        raise HTTPException(403, "Administrators only")
    return user


def allowed_origins() -> set[str]:
    return {o.strip().rstrip("/") for o in settings.cors_origins.split(",") if o.strip()} | {settings.public_base_url.rstrip("/")}


def check_origin(request: Request) -> None:
    """Cookie-authenticated POSTs (refresh, logout) must come from our own site. Browsers always send Origin on POST."""
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in allowed_origins():
        raise HTTPException(403, "Cross-site request blocked")
