"""Authenticated audio recordings. A capture is one continuous MediaRecorder file.

Chunks are ordered and retryable; separate joins remain separate playable files.
"""
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import AdminAudit, InterviewRecording, InterviewRecordingPart, InterviewSession, User

router = APIRouter(prefix="/interviews", tags=["recordings"])
MAX_PART = 4 * 1024 * 1024
MAX_SESSION = 64 * 1024 * 1024
MIMES = {"audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"}


def own(db, user, sid, *, write=False):
    s = db.scalar(select(InterviewSession).where(InterviewSession.id == sid).with_for_update())
    if not s or (s.user_id != user.id and (write or not user.is_platform_admin)):
        raise HTTPException(404, "Interview not found")
    return s


def capture(db, sid, rid):
    r = db.get(InterviewRecording, str(rid))
    if not r or r.session_id != sid:
        raise HTTPException(404, "Recording not found")
    return r


def audit(db, user, s, action, rid):
    if user.id != s.user_id:
        db.add(AdminAudit(admin_id=user.id, action=action, target=str(s.id), detail={"recording_id": str(rid)}))


class Begin(BaseModel):
    mime: str


@router.post("/{sid}/recordings", status_code=201)
def begin(sid: int, body: Begin, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = own(db, user, sid, write=True)
    if s.status != "active":
        raise HTTPException(409, "This interview has ended")
    if body.mime not in MIMES:
        raise HTTPException(422, "Unsupported audio format")
    count = db.scalar(select(func.count()).select_from(InterviewRecording).where(InterviewRecording.session_id == sid))
    size = db.scalar(select(func.coalesce(func.sum(InterviewRecording.size), 0)).where(InterviewRecording.session_id == sid))
    if count >= 20 or size >= MAX_SESSION:
        raise HTTPException(413, "This interview has reached its recording limit")
    r = InterviewRecording(id=str(uuid4()), session_id=sid, mime=body.mime)
    db.add(r)
    db.commit()
    return {"id": r.id}


@router.put("/{sid}/recordings/{rid}/parts/{sequence}")
async def upload(sid: int, rid: UUID, sequence: int, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    # Read a bounded body before acquiring the session's serialization lock.
    data = bytearray()
    async for part in request.stream():
        data.extend(part)
        if len(data) > MAX_PART:
            raise HTTPException(413, "Audio chunk exceeds 4 MB")
    if not data or not 0 <= sequence < 1000:
        raise HTTPException(422, "Invalid audio chunk")
    own(db, user, sid, write=True)
    r = capture(db, sid, rid)
    previous = db.scalar(select(InterviewRecordingPart).where(InterviewRecordingPart.recording_id == r.id, InterviewRecordingPart.sequence == sequence))
    if previous:
        if previous.content != bytes(data):
            raise HTTPException(409, "This chunk was already saved with different content")
        return {"saved": True}
    count = db.scalar(select(func.count()).select_from(InterviewRecordingPart).where(InterviewRecordingPart.recording_id == r.id))
    if r.completed or sequence != count:
        raise HTTPException(409, "Audio chunks must be uploaded in order before completion")
    size = db.scalar(select(func.coalesce(func.sum(InterviewRecording.size), 0)).where(InterviewRecording.session_id == sid))
    if size + len(data) > MAX_SESSION:
        raise HTTPException(413, "This interview has reached its 64 MB recording limit")
    db.add(InterviewRecordingPart(recording_id=r.id, sequence=sequence, content=bytes(data)))
    r.size += len(data)
    db.commit()
    return {"saved": True}


@router.post("/{sid}/recordings/{rid}/complete")
def complete(sid: int, rid: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    own(db, user, sid, write=True)
    r = capture(db, sid, rid)
    r.completed = True
    db.commit()
    return {"completed": True}


@router.get("/{sid}/recordings")
def listing(sid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    own(db, user, sid)
    rows = db.scalars(select(InterviewRecording).where(InterviewRecording.session_id == sid).order_by(InterviewRecording.created_at)).all()
    return [{"id": r.id, "created_at": r.created_at, "mime": r.mime, "bytes": r.size, "completed": r.completed} for r in rows]


@router.get("/{sid}/recordings/{rid}/audio")
def audio(sid: int, rid: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = own(db, user, sid)
    r = capture(db, sid, rid)
    if not r.size:
        raise HTTPException(404, "No audio has been uploaded")
    content = b"".join(db.scalars(select(InterviewRecordingPart.content).where(InterviewRecordingPart.recording_id == r.id).order_by(InterviewRecordingPart.sequence)).all())
    audit(db, user, s, "interview.recording.listen", rid)
    db.commit()
    return Response(content, media_type=r.mime, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/{sid}/recordings/{rid}", status_code=204)
def remove(sid: int, rid: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = own(db, user, sid)
    r = capture(db, sid, rid)
    audit(db, user, s, "interview.recording.delete", rid)
    db.delete(r)
    db.commit()
