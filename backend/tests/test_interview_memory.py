from datetime import datetime, timedelta, timezone

from app.db import SessionLocal
from app.models import InterviewSession, Resume, User
from test_interviews import script, start


def completed(client, **patch):
    with SessionLocal() as db:
        user = db.get(User, client.user_id)
        values = dict(user_id=user.id, tenant_id=user.tenant_id, kind="technical", role="Backend Engineer", status="done",
                      created_at=datetime.now(timezone.utc) - timedelta(minutes=1),
                      report={"summary": "Explain trade-offs more clearly.", "practice_plan": ["Compare two database choices with a concrete workload."]}, turns=[])
        values.update(patch)
        s = InterviewSession(**values)
        db.add(s)
        db.commit()
        return s.id


def test_memory_is_opt_in_and_private(client, make_user):
    other = make_user()
    assert client.get("/api/interviews/memory").json()["enabled"] is False
    r = client.put("/api/interviews/memory", json={"enabled": True, "notes": "Target a Java platform role"})
    assert r.status_code == 200 and r.json()["enabled"]
    assert other.get("/api/interviews/memory").json()["notes"] == ""
    completed(client, report={"summary": "Private feedback", "practice_plan": []})
    assert other.get("/api/interviews/memory").json()["sources"] == []
    other.delete("/api/interviews/memory")
    assert client.get("/api/interviews/memory").json()["notes"] == "Target a Java platform role"


def test_memory_requires_authentication(anon):
    assert anon.get("/api/interviews/memory").status_code == 401
    assert anon.put("/api/interviews/memory", json={"enabled": True, "notes": "x"}).status_code == 401
    assert anon.delete("/api/interviews/memory").status_code == 401


def test_memory_note_limits_and_whitespace(client):
    assert client.put("/api/interviews/memory", json={"enabled": True, "notes": "x" * 4001}).status_code == 422
    assert client.put("/api/interviews/memory", json={"enabled": True, "notes": "  My goals  "}).json()["notes"] == "My goals"


def test_memory_reaches_live_prompts_but_not_report_scoring(client, monkeypatch):
    completed(client)
    client.put("/api/interviews/memory", json={"enabled": True, "notes": "I want to practice queue backpressure"})
    calls = script(monkeypatch, [{"say": "Tell me about your service.", "kind": "question"}, {"say": "What was the bottleneck?", "kind": "followup", "score": 3}])
    sid = start(client, persona="Arjun").json()["id"]
    assert "queue backpressure" in calls[0][1]
    assert "Compare two database choices" in calls[0][1]
    assert "UNTRUSTED CONTEXT" in calls[0][1]
    client.post(f"/api/interviews/{sid}/answer", json={"text": "I built a queue worker"})
    assert "queue backpressure" in calls[1][1]
    assert client.post(f"/api/interviews/{sid}/finish").status_code == 200
    assert "queue backpressure" not in calls[-1][1]
    assert "PERSONAL PRACTICE MEMORY" not in calls[-1][1]


def test_pausing_memory_removes_it_from_next_turn(client, monkeypatch):
    client.put("/api/interviews/memory", json={"enabled": True, "notes": "PRIVATE GOAL"})
    calls = script(monkeypatch, [{"say": "Q?", "kind": "question"}, {"say": "Why?", "kind": "followup", "score": 3}])
    sid = start(client).json()["id"]
    client.put("/api/interviews/memory", json={"enabled": False, "notes": "PRIVATE GOAL"})
    client.post(f"/api/interviews/{sid}/answer", json={"text": "I built a service"})
    assert "PRIVATE GOAL" in calls[0][1] and "PRIVATE GOAL" not in calls[1][1]
    assert client.get("/api/interviews/memory").json()["notes"] == "PRIVATE GOAL"


def test_clear_excludes_old_sessions_after_reenabling(client):
    sid = completed(client)
    client.put("/api/interviews/memory", json={"enabled": True, "notes": "Old context"})
    assert len(client.get("/api/interviews/memory").json()["sources"]) == 1
    data = client.delete("/api/interviews/memory").json()
    assert data["notes"] == "" and data["enabled"] is False and data["sources"] == []
    assert client.get(f"/api/interviews/{sid}").status_code == 200
    assert client.put("/api/interviews/memory", json={"enabled": True, "notes": "Fresh context"}).json()["sources"] == []
    completed(client, created_at=datetime.now(timezone.utc) + timedelta(seconds=1))
    assert len(client.get("/api/interviews/memory").json()["sources"]) == 1


def test_sources_are_bounded_and_session_deletion_forgets_source(client):
    for n in range(5):
        completed(client, role=f"Role {n}")
    sources = client.get("/api/interviews/memory").json()["sources"]
    assert len(sources) == 3
    sid = sources[0]["id"]
    assert client.delete(f"/api/interviews/{sid}").status_code == 204
    assert sid not in [s["id"] for s in client.get("/api/interviews/memory").json()["sources"]]


def test_memory_never_retrieves_another_users_resume(client, make_user, monkeypatch):
    other = make_user()
    with SessionLocal() as db:
        user = db.get(User, other.user_id)
        r = Resume(user_id=user.id, tenant_id=user.tenant_id, name="Private Resume", latex="CONFIDENTIAL RESUME CONTENT")
        db.add(r)
        db.commit()
        rid = r.id
    completed(client, resume_id=rid)
    client.put("/api/interviews/memory", json={"enabled": True, "notes": "My goals"})
    assert client.get("/api/interviews/memory").json()["resume"] is None
    calls = script(monkeypatch, [{"say": "Q?", "kind": "question"}])
    assert start(client).status_code == 200
    assert "CONFIDENTIAL RESUME CONTENT" not in calls[0][1]


def test_assigned_persona_is_stable_and_ignores_client_override(client, monkeypatch):
    script(monkeypatch, [{"say": "Hi, I am Priya, your AI interviewer.", "kind": "question"}])
    data = start(client, kind="technical", persona="Priya").json()
    assert data["interviewer"] == {"name": "Karthik", "voice": "cedar", "gender": "male"}
    assert client.get(f"/api/interviews/{data['id']}").json()["interviewer"] == data["interviewer"]
    # Client-supplied persona is ignored; the interview type owns assignment.


def test_detailed_report_anchors_assessments_to_saved_candidate_turns(client, monkeypatch):
    report = {"overall": 75, "summary": "Reasoned about trade-offs.", "evidence": [
        {"turn_index": 1, "category": "strength", "assessment": "The candidate connected retry policy to idempotency.", "quote": "A fabricated quote must not be used.", "next_step": "Explore a timeout failure."},
        {"turn_index": 0, "assessment": "Not candidate evidence"}, {"turn_index": 999, "assessment": "Invented turn"}]}
    calls = script(monkeypatch, [{"say": "Describe a reliability decision.", "kind": "question"}, {"say": "Why did you choose that?", "kind": "followup", "score": 4}], report=report)
    sid = start(client, kind="technical").json()["id"]
    words = "I made retries idempotent so a timeout would not duplicate a payment."
    client.post(f"/api/interviews/{sid}/answer", json={"text": words})
    data = client.post(f"/api/interviews/{sid}/finish").json()
    evidence = data["report"]["evidence"]
    assert len(evidence) == 1 and evidence[0]["quote"] == words
    assert evidence[0]["at"] == data["turns"][1]["at"]
    assert data["report"]["generated_at"] and data["report"]["session_started_at"]
    assert "Open question to resolve: Describe a reliability decision." in calls[1][1]
    assert "[Turn 1] CANDIDATE:" in calls[-1][1]

