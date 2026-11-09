from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import SettingsOut, SettingsUpdate
from ..services import settings_store
from ..services.latex import latex_available

router = APIRouter(prefix="/settings", tags=["settings"])


def _out(db: Session) -> SettingsOut:
    key, source = settings_store.get_openai_key(db)
    return SettingsOut(
        openai_configured=bool(key),
        openai_key_hint=f"…{key[-4:]}" if key else "",
        openai_key_source=source,
        openai_model=settings_store.get_model(db),
        latex_available=latex_available(),
    )


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return _out(db)


@router.put("", response_model=SettingsOut)
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    if body.clear_openai_key:
        settings_store.set_openai_key(db, "")
    elif body.openai_api_key:
        settings_store.set_openai_key(db, body.openai_api_key.strip())
    if body.openai_model is not None:
        settings_store.set_value(db, "openai_model", body.openai_model.strip())
    return _out(db)
