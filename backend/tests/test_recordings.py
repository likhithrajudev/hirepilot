from app.db import SessionLocal
from app.models import AdminAudit, InterviewRecordingPart, InterviewSession, User
from sqlalchemy import select, func


def session(client):
    with SessionLocal() as db:
        user = db.get(User, client.user_id)
        s = InterviewSession(user_id=user.id, tenant_id=user.tenant_id, kind="technical", role="Engineer", status="active", turns=[])
        db.add(s)
        db.commit()
        return s.id


def begin(client, sid):
    r = client.post(f"/api/interviews/{sid}/recordings", json={"mime": "audio/webm;codecs=opus"})
    assert r.status_code == 201, r.text
    return f"/api/interviews/{sid}/recordings/{r.json()['id']}"


def test_recording_is_ordered_retryable_and_playable(client):
    sid = session(client)
    url = begin(client, sid)
    assert client.put(url + "/parts/1", content=b"second").status_code == 409
    assert client.put(url + "/parts/0", content=b"first").status_code == 200
    assert client.put(url + "/parts/0", content=b"first").status_code == 200
    assert client.put(url + "/parts/0", content=b"different").status_code == 409
    assert client.put(url + "/parts/1", content=b"second").status_code == 200
    rows = client.get(f"/api/interviews/{sid}/recordings").json()
    assert rows[0]["bytes"] == 11 and not rows[0]["completed"]
    assert client.post(url + "/complete").status_code == 200
    assert client.put(url + "/parts/2", content=b"late").status_code == 409
    response = client.get(url + "/audio")
    assert response.content == b"firstsecond"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-type"].startswith("audio/webm")


def test_recordings_are_private_and_admin_reads_are_audited(client, make_user, anon):
    other = make_user()
    sid = session(client)
    url = begin(client, sid)
    client.put(url + "/parts/0", content=b"private")
    assert anon.get(url + "/audio").status_code == 401
    assert other.get(url + "/audio").status_code == 404
    assert other.get(f"/api/interviews/{sid}/recordings").status_code == 404
    assert other.delete(url).status_code == 404
    with SessionLocal() as db:
        db.get(User, other.user_id).is_platform_admin = True
        db.commit()
    assert other.get(url + "/audio").content == b"private"
    assert other.put(url + "/parts/1", content=b"injected").status_code == 404
    with SessionLocal() as db:
        event = db.scalar(select(AdminAudit).where(AdminAudit.admin_id == other.user_id, AdminAudit.action == "interview.recording.listen"))
        assert event and event.target == str(sid)
    assert client.delete(url).status_code == 204
    assert other.get(url + "/audio").status_code == 404
    assert client.get(f"/api/interviews/{sid}/recordings").json() == []


def test_capture_belongs_to_session_and_deletion_removes_parts(client):
    sid = session(client)
    other_sid = session(client)
    url = begin(client, sid)
    client.put(url + "/parts/0", content=b"audio")
    assert client.get(url.replace(f"/{sid}/", f"/{other_sid}/") + "/audio").status_code == 404
    rid = url.split("/")[-1]
    assert client.delete(f"/api/interviews/{sid}").status_code == 204
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(InterviewRecordingPart).where(InterviewRecordingPart.recording_id == rid)) == 0


def test_recording_limits_and_finished_session(client, monkeypatch):
    from app.routers import recordings
    sid = session(client)
    assert client.post(f"/api/interviews/{sid}/recordings", json={"mime": "text/html"}).status_code == 422
    url = begin(client, sid)
    monkeypatch.setattr(recordings, "MAX_PART", 10)
    monkeypatch.setattr(recordings, "MAX_SESSION", 12)
    assert client.put(url + "/parts/0", content=b"x" * 11).status_code == 413
    assert client.put(url + "/parts/0", content=b"").status_code == 422
    assert client.put(url + "/parts/0", content=b"x" * 8).status_code == 200
    assert client.put(url + "/parts/1", content=b"x" * 8).status_code == 413
    with SessionLocal() as db:
        db.get(InterviewSession, sid).status = "done"
        db.commit()
    assert client.post(f"/api/interviews/{sid}/recordings", json={"mime": "audio/mp4"}).status_code == 409
    # Final chunks from a capture that began during the interview can still flush.
    assert client.put(url + "/parts/1", content=b"end").status_code == 200
    assert client.post(url + "/complete").status_code == 200
