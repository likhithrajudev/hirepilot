from fastapi import APIRouter, HTTPException, Query, Response

from ..services import templates as svc

router = APIRouter(prefix="/templates", tags=["templates"])  # behind the token gate
public = APIRouter(prefix="/templates", tags=["templates"])  # <img> tags cannot send the token; previews are sample data


@router.get("")
def list_templates():
    return svc.listing()


@public.get("/{template_id}/preview.png")
async def preview_png(template_id: str, paper: str = Query("a4paper", pattern="^(a4paper|letterpaper)$")):
    if template_id not in {t["id"] for t in svc.TEMPLATES}:
        raise HTTPException(404, "Unknown template")
    p = await svc.preview(template_id, paper)
    if not p:
        raise HTTPException(503, "Preview unavailable (no LaTeX engine on this server)")
    return Response(p["png"], media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})
