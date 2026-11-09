"""Key/value settings in the DB. The OpenAI key is encrypted at rest with a key derived from SECRET_KEY."""
import base64
import hashlib
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from ..config import settings
from ..models import AppSetting
from .context import current_user_id


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _key(key: str, user_id: Optional[int]) -> str:
    """Settings are per user: u<id>:<key>. With no user in scope (startup, legacy data) the bare key is used."""
    uid = user_id if user_id is not None else current_user_id.get()
    return f"u{uid}:{key}" if uid is not None else key


def get_value(db: Session, key: str, user_id: Optional[int] = None) -> str:
    row = db.get(AppSetting, _key(key, user_id))
    return row.value if row else ""


def set_value(db: Session, key: str, value: str, user_id: Optional[int] = None) -> None:
    k = _key(key, user_id)
    row = db.get(AppSetting, k)
    if row is None:
        db.add(AppSetting(key=k, value=value))
    else:
        row.value = value
    db.commit()


def get_openai_key(db: Session) -> tuple[str, str]:
    """Returns (key, source) where source is 'ui', 'env' or 'none'."""
    token = get_value(db, "openai_api_key")
    if token:
        try:
            return _fernet().decrypt(token.encode()).decode(), "ui"
        except InvalidToken:
            pass  # SECRET_KEY changed; fall through to env
    if settings.openai_api_key:
        return settings.openai_api_key, "env"
    return "", "none"


def set_openai_key(db: Session, key: str) -> None:
    set_value(db, "openai_api_key", _fernet().encrypt(key.encode()).decode() if key else "")


def get_model(db: Session) -> str:
    return get_value(db, "openai_model") or settings.openai_model
