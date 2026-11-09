"""Creating accounts, linking OAuth identities, and claiming data that predates accounts."""
import re
from typing import Any, Optional

from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from ..config import settings
from ..models import AiTask, AppSetting, OAuthIdentity, Resume, Tenant, User
from . import settings_store
from .security import AuthError, now

_LEGACY_KEYS = ("applicant_profile", "preferences", "openai_api_key", "openai_model")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def valid_email(email: str) -> bool:
    return bool(re.fullmatch(r"[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}", email)) and len(email) <= 320


def _slug(db: Session, base: str) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")[:40] or "workspace"
    slug, n = stem, 1
    while db.scalar(select(Tenant.id).where(Tenant.slug == slug)):
        n += 1
        slug = f"{stem}-{n}"
    return slug


def create_account(db: Session, email: str, name: str = "", password_hash: Optional[str] = None,
                   email_verified: bool = False, avatar_url: Optional[str] = None) -> User:
    email = normalize_email(email)
    display = name.strip() or email.split("@")[0]
    first_user = (db.scalar(select(func.count()).select_from(User)) or 0) == 0
    tenant = Tenant(name=f"{display}'s workspace", slug=_slug(db, email.split("@")[0]), plan="free")
    db.add(tenant)
    db.flush()
    admins = {normalize_email(e) for e in settings.admin_emails.split(",") if e.strip()}
    # Platform admin: anyone listed in ADMIN_EMAILS. If none are listed (a fresh personal deployment), the first account.
    user = User(tenant_id=tenant.id, email=email, name=display, password_hash=password_hash, role="owner", email_verified=email_verified,
                avatar_url=avatar_url, is_platform_admin=(email in admins) or (first_user and not admins))
    db.add(user)
    db.commit()
    db.refresh(user)
    claim_legacy_data(db, user)  # decides for itself whether this account is the one entitled to it
    return user


def claim_legacy_data(db: Session, user: User) -> bool:
    """One time: hand data created before accounts existed to its owner, so upgrading never loses a resume, version,
    task, preference, OpenAI key or job status. If CLAIM_LEGACY_EMAIL is set, only that email may claim, whenever it signs
    up (so a stranger or a test account that registers first cannot take it). If it is not set, the first account does."""
    if db.get(AppSetting, "legacy_claimed"):
        return False
    if settings.claim_legacy_email:
        if normalize_email(settings.claim_legacy_email) != user.email:
            return False
    elif (db.scalar(select(func.count()).select_from(User)) or 0) != 1:
        return False
    db.execute(update(Resume).where(Resume.user_id.is_(None)).values(user_id=user.id, tenant_id=user.tenant_id))
    db.execute(update(AiTask).where(AiTask.user_id.is_(None)).values(user_id=user.id, tenant_id=user.tenant_id))
    for key in _LEGACY_KEYS:  # global settings become this user's settings
        row = db.get(AppSetting, key)
        if row is not None:
            settings_store.set_value(db, key, row.value, user_id=user.id)
            db.delete(row)
    db.execute(text(
        "INSERT INTO user_jobs (user_id, job_id, status, score, score_reason, score_detail, scored_resume_id, updated_at) "
        "SELECT :uid, id, status, score, score_reason, score_detail, scored_resume_id, CURRENT_TIMESTAMP FROM jobs "
        "WHERE (status IS NOT NULL AND status <> 'new') OR score IS NOT NULL"), {"uid": user.id})
    db.add(AppSetting(key="legacy_claimed", value=str(user.id)))
    db.commit()
    return True


def resolve_oauth(db: Session, provider: str, subject: str, email: Optional[str], email_verified: bool,
                  name: str = "", avatar_url: Optional[str] = None) -> tuple[User, bool]:
    """Find or create the user for a provider login. Returns (user, created).

    Linking to an existing account by email happens ONLY when the provider vouches that the email is verified.
    Linking on an unverified email would let anyone take over an account by registering its address elsewhere."""
    ident = db.scalar(select(OAuthIdentity).where(OAuthIdentity.provider == provider, OAuthIdentity.subject == subject))
    if ident:
        user = db.get(User, ident.user_id)
        if not user or not user.is_active:
            raise AuthError("Account disabled.", 403)
        return user, False
    email_n = normalize_email(email) if email else None
    if not email_n or not valid_email(email_n):
        raise AuthError("This provider did not share an email address, so we cannot create your account.", 400)
    existing = db.scalar(select(User).where(User.email == email_n))
    if existing:
        if not email_verified:
            raise AuthError("An account with this email exists, but the provider has not verified it. Sign in with your password instead.", 409)
        if not existing.is_active:
            raise AuthError("Account disabled.", 403)
        db.add(OAuthIdentity(user_id=existing.id, provider=provider, subject=subject, email=email_n))
        existing.email_verified = True
        if not existing.avatar_url and avatar_url:
            existing.avatar_url = avatar_url
        db.commit()
        return existing, False
    if not settings.signup_open:
        raise AuthError("Sign-ups are closed.", 403)
    user = create_account(db, email_n, name, None, email_verified, avatar_url)
    db.add(OAuthIdentity(user_id=user.id, provider=provider, subject=subject, email=email_n))
    db.commit()
    return user, True


def me_payload(db: Session, user: User) -> dict[str, Any]:
    tenant = db.get(Tenant, user.tenant_id)
    return {
        "id": user.id, "email": user.email, "name": user.name, "avatar_url": user.avatar_url, "role": user.role,
        "is_platform_admin": user.is_platform_admin, "email_verified": user.email_verified, "has_password": bool(user.password_hash),
        "providers": sorted(i.provider for i in user.identities),
        "tenant": {"id": tenant.id, "name": tenant.name, "slug": tenant.slug, "plan": tenant.plan} if tenant else None,
    }


def touch_login(db: Session, user: User) -> None:
    user.last_login_at = now()
    db.commit()
