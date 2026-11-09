from app.services import coding

from test_interviews import script

CONFIG = {"type": "Technical", "minutes": 20, "competencies": ["API design", "Concurrency"], "persona": "Arjun", "intensity": 4,
          "questions": [{"text": "Two users book the last seat at once. How does your system decide?", "comp": "Concurrency", "minutes": 6, "followups": "Up to 2"}], "published": True}
ASSESSMENT = {"title": "Backend screen", "duration_min": 30, "cutoff": 60, "questions": [
    {"kind": "mc", "text": "Which keyword prevents subclassing?", "options": ["static", "final", "abstract"], "correct": 1, "points": 10},
    {"kind": "mc", "text": "Which clause filters groups?", "options": ["WHERE", "HAVING"], "correct": 1, "points": 10},
    {"kind": "problem", "problem_id": "pairs", "points": 20}]}


def setup_role(c, with_assessment=False):
    jid = c.post("/api/teams/jobs", json={"title": "Backend Engineer", "location": "Bengaluru"}).json()["id"]
    assert c.post(f"/api/teams/jobs/{jid}/candidates", json={"name": "Too Early"}).status_code == 409, "publish the interviewer before inviting"
    saved = c.put(f"/api/teams/jobs/{jid}/interviewer", json=CONFIG).json()
    assert saved["published"] is True and saved["persona"] == "Arjun"
    if with_assessment:
        aid = c.post("/api/assessments", json=ASSESSMENT).json()["id"]
        assert c.patch(f"/api/teams/jobs/{jid}", json={"assessment_id": aid}).status_code == 200
        return jid, aid
    return jid, None


def test_invite_interview_report_and_pipeline(client, make_user, anon, monkeypatch):
    calls = script(monkeypatch, [{"say": "Hi, I'm Arjun. Tell me about yourself.", "kind": "question"}, {"say": "Thanks. Any questions for me?", "kind": "wrapup", "score": 4, "note": "ok"}])
    jid, _ = setup_role(client)
    assert client.put(f"/api/teams/jobs/{jid}/interviewer", json={**CONFIG, "persona": "Nobody"}).status_code == 422
    assert client.put(f"/api/teams/jobs/{jid}/interviewer", json={**CONFIG, "competencies": [], "questions": []}).status_code == 422, "nothing to publish"
    cand = client.post(f"/api/teams/jobs/{jid}/candidates", json={"name": "Meera Krishnan", "school": "NIT Trichy"}).json()
    token = cand["invite_path"].split("/")[-1]
    assert cand["tags"] == ["Invited"] and cand["stage"] == "applied"

    info = anon.get(f"/api/invites/{token}").json()
    assert info["role"] == "Backend Engineer" and info["first_name"] == "Meera" and info["interviewer"] == "Arjun" and info["interview"] is None and "token" not in str(info)
    assert anon.get("/api/invites/not-a-real-token").status_code == 404

    meera, stranger = make_user(), make_user()
    r = meera.post(f"/api/invites/{token}/interview", json={"mode": "text", "consent_monitoring": True})
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]
    assert "HIRING TEAM'S INTERVIEW PLAN" in calls[0][1] and "last seat" in calls[0][1] and "rigorous" not in calls[0][1] and "probing" in calls[0][1]
    s = meera.get(f"/api/interviews/{sid}").json()
    assert s["interviewer"]["name"] == "Arjun" and s["proctored"] is True and s["duration_min"] == 20
    assert stranger.post(f"/api/invites/{token}/interview", json={}).status_code == 403, "an invite belongs to the first account that opens it"
    assert meera.post(f"/api/invites/{token}/interview", json={"mode": "text"}).json()["session_id"] == sid, "reopening the invite returns to the same interview"
    assert client.get("/api/billing/subscription").json()["usage"]["interview"]["used"] == 1, "the team's credits pay for it: a text interview costs one"
    assert meera.get("/api/billing/subscription").json()["usage"]["interview"]["used"] == 0

    assert meera.post(f"/api/interviews/{sid}/answer", json={"text": "I built a booking system and owned its seat locking."}).status_code == 200
    assert meera.post(f"/api/interviews/{sid}/finish").status_code == 200
    pipe = client.get(f"/api/teams/jobs/{jid}/pipeline").json()
    card = next(c for col in pipe["columns"] for c in col["cards"] if c["id"] == cand["id"])
    assert card["ai_score"] == 72 and card["recommendation"] == "hold" and card["stage"] == "interview"
    assert pipe["summary"]["interviewed"] == 1 and pipe["summary"]["finished_last_day"] == 1
    full = client.get(f"/api/teams/candidates/{cand['id']}").json()
    assert full["interview"]["report"]["overall"] == 72 and full["interview"]["integrity"]["monitored"] is True and full["job"]["title"] == "Backend Engineer"
    assert meera.post(f"/api/invites/{token}/interview", json={}).status_code == 409, "an interview is taken once"

    assert client.post(f"/api/teams/candidates/{cand['id']}/stage", json={"stage": "panel"}).json()["stage"] == "panel"
    assert client.post(f"/api/teams/candidates/{cand['id']}/stage", json={"stage": "nonsense"}).status_code == 422
    notes = client.post(f"/api/teams/candidates/{cand['id']}/notes", json={"text": "Strong on locking."}).json()
    assert notes[0]["text"] == "Strong on locking."
    assert stranger.get(f"/api/teams/candidates/{cand['id']}").status_code == 404 and stranger.get(f"/api/teams/jobs/{jid}/pipeline").status_code == 404, "another workspace sees nothing"
    assert stranger.post(f"/api/teams/candidates/{cand['id']}/stage", json={"stage": "offer"}).status_code == 404


def test_assessment_build_take_grade_and_results(client, make_user, monkeypatch):
    jid, aid = setup_role(client, with_assessment=True)
    assert client.post("/api/assessments", json={**ASSESSMENT, "questions": [{"kind": "mc", "text": "Pick one please", "options": ["a", "b"], "correct": 5}]}).status_code == 422
    assert client.post("/api/assessments", json={**ASSESSMENT, "questions": [{"kind": "problem", "problem_id": "nope"}]}).status_code == 422
    cand = client.post(f"/api/teams/jobs/{jid}/candidates", json={"name": "Arjun Shetty"}).json()
    token = cand["invite_path"].split("/")[-1]
    who = make_user()
    attempt = who.post(f"/api/invites/{token}/assessment").json()["attempt_id"]
    assert who.post(f"/api/invites/{token}/assessment").json()["attempt_id"] == attempt
    view = who.get(f"/api/assessments/attempts/{attempt}").json()
    assert len(view["questions"]) == 3 and "correct" not in str(view["questions"]) and view["seconds_left"] > 1700 and view["questions"][2]["problem"]["statement"]
    assert make_user().get(f"/api/assessments/attempts/{attempt}").status_code == 404

    assert who.put(f"/api/assessments/attempts/{attempt}/answers", json={"index": 0, "choice": 1}).status_code == 200
    assert who.put(f"/api/assessments/attempts/{attempt}/answers", json={"index": 1, "choice": 0}).status_code == 200
    assert who.put(f"/api/assessments/attempts/{attempt}/answers", json={"index": 2, "choice": 0}).status_code == 422, "a coding question has no choices"

    async def fake(language, source, cases):
        return {"status": "accepted", "passed": len(cases) // 2, "total": len(cases), "cases": []}

    monkeypatch.setattr(coding, "execute", fake)
    assert who.post(f"/api/assessments/attempts/{attempt}/problems/2/run", json={"language": "python", "source": "x", "mode": "submit"}).status_code == 200
    assert who.post(f"/api/assessments/attempts/{attempt}/problems/0/run", json={"language": "python", "source": "x"}).status_code == 404
    assert who.post(f"/api/assessments/attempts/{attempt}/finish").status_code == 200
    assert who.put(f"/api/assessments/attempts/{attempt}/answers", json={"index": 0, "choice": 0}).status_code == 409, "nothing changes after the end"

    res = client.get(f"/api/assessments/{aid}/results").json()
    assert res["summary"]["completed"] == 1 and res["summary"]["invited"] == 1
    # 10 (right) + 0 (wrong) + about half of 20 (half the tests passed) out of 40
    assert 40 <= res["rows"][0]["score"] <= 60 and res["rows"][0]["name"] == "Arjun Shetty" and sum(res["histogram"]) == 1
    assert res["hardest"][0]["percent"] <= res["hardest"][-1]["percent"]
    assert client.put(f"/api/assessments/{aid}", json=ASSESSMENT).status_code == 409, "questions are frozen once someone has started"
    card = client.get(f"/api/teams/candidates/{cand['id']}").json()
    assert card["assessment"]["status"] == "done" and card["stage"] == "assessment" and any(t.startswith("Assessment ") for t in card["tags"])
    assert make_user().get(f"/api/assessments/{aid}/results").status_code == 404
