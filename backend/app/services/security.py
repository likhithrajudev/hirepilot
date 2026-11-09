"""Passwords, access tokens and rotating refresh tokens."""
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..models import RefreshToken, User

ALGO = "HS256"
GRACE_SECONDS = 10  # a second tab refreshing with the same cookie just after the first is not an attack


class AuthError(Exception):
    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.message, self.status = message, status


def now() -> datetime:
    return datetime.now(timezone.utc)


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


# ---------- passwords ----------
_hasher: Optional[PasswordHasher] = None


def _h() -> PasswordHasher:
    global _hasher
    if _hasher is None:
        _hasher = PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1) if settings.fast_password_hash else PasswordHasher()
    return _hasher


def hash_password(pw: str) -> str:
    return _h().hash(pw)


def verify_password(pw_hash: Optional[str], pw: str) -> bool:
    if not pw_hash:
        return False
    try:
        return _h().verify(pw_hash, pw)
    except (VerificationError, InvalidHashError):
        return False


_COMMON = {"password", "password1", "password12", "password123", "1234567890", "qwertyuiop", "letmein123", "iloveyou12", "admin12345", "welcome123", "abc1234567", "1q2w3e4r5t"}


def validate_password(pw: str, email: str = "") -> None:
    """Length beats composition rules. Rejects the obvious: short, common, or just the email."""
    if len(pw) < 10:
        raise AuthError("Use at least 10 characters.", 422)
    if len(pw) > 200:
        raise AuthError("That password is too long.", 422)
    low = pw.lower()
    if low in _COMMON or len(set(pw)) < 4:
        raise AuthError("That password is too easy to guess. Try a short phrase instead.", 422)
    local = email.split("@")[0].lower() if email else ""
    if local and len(local) >= 4 and local in low:
        raise AuthError("Do not use your email in your password.", 422)


# ---------- access tokens ----------
def make_access_token(user: User) -> tuple[str, int]:
    exp = now() + timedelta(minutes=settings.access_token_minutes)
    claims = {"sub": str(user.id), "tid": user.tenant_id, "role": user.role, "ver": user.token_version, "typ": "access",
              "jti": uuid.uuid4().hex, "iat": int(now().timestamp()), "exp": int(exp.timestamp())}
    return jwt.encode(claims, settings.secret_key, algorithm=ALGO), settings.access_token_minutes * 60


def decode_access_token(token: str) -> dict:
    try:
        claims = jwt.decode(token, settings.secret_key, algorithms=[ALGO], options={"require": ["exp", "sub", "typ"]})
    except jwt.ExpiredSignatureError:
        raise AuthError("token_expired")
    except jwt.InvalidTokenError:
        raise AuthError("invalid_token")
    if claims.get("typ") != "access":
        raise AuthError("invalid_token")
    return claims


# ---------- refresh tokens ----------
def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite hands back naive datetimes


def issue_refresh(db: Session, user: User, family_id: Optional[str] = None, user_agent: str = "", ip: str = "") -> tuple[str, RefreshToken]:
    raw = secrets.token_urlsafe(48)
    row = RefreshToken(id=uuid.uuid4().hex, user_id=user.id, family_id=family_id or uuid.uuid4().hex, token_hash=sha256(raw),
                       expires_at=now() + timedelta(days=settings.refresh_token_days), user_agent=user_agent[:300], ip=ip[:64])
    db.add(row)
    db.commit()
    return raw, row


def revoke_family(db: Session, family_id: str) -> None:
    db.execute(update(RefreshToken).where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=now()))
    db.commit()


def revoke_all(db: Session, user_id: int) -> None:
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=now()))
    db.commit()


def rotate_refresh(db: Session, raw: str, user_agent: str = "", ip: str = "") -> tuple[User, str, RefreshToken]:
    """Exchange a refresh token for a new one. Reusing an already-rotated token outside the grace window revokes the
    entire family: whoever holds the old token and whoever holds the new one cannot both be legitimate."""
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256(raw)))
    if not row:
        raise AuthError("Session expired. Please sign in again.")
    if row.revoked_at is not None:
        raise AuthError("Session expired. Please sign in again.")
    if _aware(row.expires_at) <= now():
        raise AuthError("Session expired. Please sign in again.")
    if row.rotated_at is not None and (now() - _aware(row.rotated_at)).total_seconds() > GRACE_SECONDS:
        revoke_family(db, row.family_id)  # reuse detected
        raise AuthError("Session expired. Please sign in again.")
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise AuthError("Account disabled.", 403)
    if row.rotated_at is None:
        row.rotated_at = now()
    new_raw, new_row = issue_refresh(db, user, family_id=row.family_id, user_agent=user_agent or row.user_agent, ip=ip or row.ip)
    return user, new_raw, new_row


# ---------- single-use emailed tokens ----------
def new_url_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(40)
    return raw, sha256(raw)
