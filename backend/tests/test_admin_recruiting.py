import io
import json

import pytest
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from app.db import SessionLocal
from app.models import AdminAudit, FeatureUse, User
from app.routers import recruiting


@pytest.fixture()
def admin_client(client):
    with SessionLocal() as db:
        db.get(User, client.user_id).is_platform_admin = True
        db.commit()
    return client


def create_role(admin, **changes):
    body = {"title": "Platform Engineer", "company": "Example Engineering", "location": "Remote",
            "description": "Build reliable services and collaborate on well-tested platform software.",
            "requirements": ["Python", "SQL"], "questions": ["Describe a project you owned."], "status": "published"}
    body.update(changes)
    result = admin.post("/api/admin/jobs", json=body)
    assert result.status_code == 201, result.text
    return result.json()


def resume_pdf():
    writer = PdfWriter()
    page = writer.add_blank_page(width=400, height=400)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 12 Tf 20 350 Td (Built Python API services with SQL and automated tests.) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(stream)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def apply(candidate, job, **changes):
    body = {"full_name": "Example Candidate", "answers": ["I built and tested a Python API."]}
    body.update(changes)
    return candidate.post(f"/api/careers/{job['slug']}/apply", data={"profile": json.dumps(body)}, files={"resume": ("resume.pdf", resume_pdf(), "application/pdf")})


def test_admin_routes_enforce_server_authorization(client, anon):
    for path in ("overview", "users", "users/1", "usage", "audit", "interviews", "jobs"):
        assert client.get(f"/api/admin/{path}").status_code == 403
        assert anon.get(f"/api/admin/{path}").status_code == 401
    assert client.post("/api/admin/users/1/reset-usage", json={"reason": "Support request"}).status_code == 403
    assert client.post("/api/admin/jobs", json={}).status_code == 403


def test_block_revokes_sessions_and_admin_cannot_block_self(admin_client, make_user):
    candidate = make_user()
    assert candidate.get("/api/auth/me").status_code == 200
    response = admin_client.post(f"/api/admin/users/{candidate.user_id}/block", json={"blocked": True, "reason": "Abuse report verified"})
    assert response.status_code == 200 and response.json()["active"] is False
    assert candidate.get("/api/auth/me").status_code == 401
    assert admin_client.post(f"/api/admin/users/{admin_client.user_id}/block", json={"blocked": True, "reason": "Do not lock out admin"}).status_code == 409
    assert admin_client.post(f"/api/admin/users/{candidate.user_id}/block", json={"blocked": False, "reason": "Review completed"}).json()["active"]
    # Unblocking must not revive the old bearer token.
    assert candidate.get("/api/auth/me").status_code == 401
    audit = admin_client.get("/api/admin/audit").json()
    assert any(a["action"] == "user.block" and a["admin_id"] == admin_client.user_id for a in audit)


def test_usage_reset_is_append_only_and_idempotent(admin_client, make_user):
    candidate = make_user()
    with SessionLocal() as db:
        u = db.get(User, candidate.user_id)
        db.add(FeatureUse(tenant_id=u.tenant_id, user_id=u.id, feature="interview", units=3))
        db.commit()
    path = f"/api/admin/users/{candidate.user_id}/reset-usage"
    assert admin_client.post(path, json={"reason": "Customer support credit"}).json()["reset"]["interview"] == 3
    assert admin_client.post(path, json={"reason": "Repeat support request"}).json()["reset"] == {}
    with SessionLocal() as db:
        rows = db.query(FeatureUse).filter(FeatureUse.user_id == candidate.user_id).all()
        assert sorted(r.units for r in rows) == [-3, 3]
    detail = admin_client.get(f"/api/admin/users/{candidate.user_id}").json()
    assert detail["monthly_usage"]["interview"] == 0


def test_overview_users_and_subscription_are_real_records(admin_client, make_user):
    candidate = make_user()
    response = admin_client.get("/api/admin/overview?days=7")
    assert response.status_code == 200 and response.json()["users"] >= 2
    data = admin_client.get(f"/api/admin/users?q={candidate.email}").json()
    assert data["total"] == 1 and data["items"][0]["id"] == candidate.user_id
    assert "subscription" in admin_client.get(f"/api/admin/users/{candidate.user_id}").json()


def test_job_publication_and_application_lifecycle(admin_client, make_user, anon):
    candidate, other = make_user(), make_user()
    draft = create_role(admin_client, status="draft")
    assert anon.get(f"/api/careers/{draft['slug']}").status_code == 404
    job = create_role(admin_client)
    assert anon.get(f"/api/careers/{job['slug']}").status_code == 200
    assert apply(anon, job).status_code == 401
    result = apply(candidate, job)
    assert result.status_code == 201, result.text
    a = result.json()
    assert a["email"] == candidate.email and "ai_review" not in a and a["status"] == "submitted"
    assert apply(candidate, job).status_code == 409
    assert other.get("/api/applications").json() == []
    assert other.get(f"/api/applications/{a['id']}/resume").status_code == 404
    assert other.post(f"/api/applications/{a['id']}/withdraw").status_code == 404
    assert candidate.get(f"/api/applications/{a['id']}/resume").content.startswith(b"%PDF-")
    assert admin_client.get(f"/api/applications/{a['id']}/resume").status_code == 200
    status = admin_client.post(f"/api/admin/applications/{a['id']}/status", json={"status": "in_review", "message": "The hiring team is reviewing your application."})
    assert status.status_code == 200
    tracked = candidate.get("/api/applications").json()[0]
    assert tracked["status"] == "in_review" and len(tracked["history"]) == 2
    assert candidate.post(f"/api/applications/{a['id']}/withdraw").json()["status"] == "withdrawn"
    assert admin_client.post(f"/api/admin/applications/{a['id']}/status", json={"status": "interview", "message": "Please book a slot."}).status_code == 409


def test_application_validation_and_closed_role(admin_client, make_user):
    candidate = make_user()
    job = create_role(admin_client)
    assert apply(candidate, job, answers=[]).status_code == 422
    response = candidate.post(f"/api/careers/{job['slug']}/apply", data={"profile": json.dumps({"full_name": "Test User", "answers": ["My answer"]})}, files={"resume": ("bad.pdf", b"Not a PDF", "application/pdf")})
    assert response.status_code == 422
    job["status"] = "closed"
    assert admin_client.put(f"/api/admin/jobs/{job['id']}", json=job).status_code == 200
    assert apply(candidate, job).status_code == 404


def test_ai_ranking_requires_verifiable_resume_evidence(admin_client, make_user, monkeypatch):
    candidate = make_user()
    job = create_role(admin_client)
    a = apply(candidate, job).json()
    async def fake(*args, **kwargs):
        return {"criteria": [{"index": 0, "level": "met", "evidence": "Python API services", "reason": "Relevant API development evidence."}, {"index": 1, "level": "met", "evidence": "Invented database achievement", "reason": "Unsupported"}], "summary": "Evidence review"}
    monkeypatch.setattr(recruiting, "json_chat", fake)
    assert candidate.post(f"/api/admin/applications/{a['id']}/review").status_code == 403
    reviewed = admin_client.post(f"/api/admin/applications/{a['id']}/review")
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["ai_score"] == 50
    assert reviewed.json()["ai_review"]["criteria"][1]["level"] == "not_evidenced"
    assert "ai_review" not in candidate.get("/api/applications").json()[0]
    job["requirements"] = ["Python", "SQL", "Testing"]
    assert admin_client.put(f"/api/admin/jobs/{job['id']}", json=job).status_code == 200
    assert admin_client.get(f"/api/admin/jobs/{job['id']}/applications").json()[0]["ai_review"] is None


def test_malformed_ai_review_saves_no_score(admin_client, make_user, monkeypatch):
    job = create_role(admin_client)
    a = apply(make_user(), job).json()
    async def fake(*args, **kwargs):
        return {"criteria": [{"index": 99, "level": "met", "evidence": "SQL"}]}
    monkeypatch.setattr(recruiting, "json_chat", fake)
    assert admin_client.post(f"/api/admin/applications/{a['id']}/review").status_code == 502
    assert admin_client.get(f"/api/admin/jobs/{job['id']}/applications").json()[0]["ai_score"] is None


def test_question_snapshot_survives_changes_to_the_form(admin_client, make_user):
    candidate = make_user()
    job = create_role(admin_client)
    result = apply(candidate, job).json()
    assert result["answers"][0]["question"] == "Describe a project you owned."
    job["questions"] = ["A new question for future applicants"]
    assert admin_client.put(f"/api/admin/jobs/{job['id']}", json=job).status_code == 200
    historical = admin_client.get(f"/api/admin/jobs/{job['id']}/applications").json()[0]
    assert historical["answers"][0]["question"] == "Describe a project you owned."


def test_admin_can_inspect_interviews_but_regular_users_cannot(admin_client, make_user, monkeypatch):
    from test_interviews import script, start
    candidate = make_user()
    script(monkeypatch, [{"say": "Describe your project.", "kind": "question"}])
    sid = start(candidate).json()["id"]
    assert candidate.get(f"/api/admin/interviews/{sid}").status_code == 403
    viewed = admin_client.get(f"/api/admin/interviews/{sid}")
    assert viewed.status_code == 200 and viewed.json()["user_id"] == candidate.user_id
    assert viewed.json()["turns"][0]["at"]
    assert admin_client.post(f"/api/admin/interviews/{sid}/report").status_code == 409
    assert any(e["action"] == "interview.view" and e["target"] == f"interview:{sid}" for e in admin_client.get("/api/admin/audit").json())
