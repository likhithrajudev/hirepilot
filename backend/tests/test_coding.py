import json
from functools import partial
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select, func

from app.config import settings
from app.db import SessionLocal
from app.models import CodingRun, CodingWorkspace, InterviewSession, User
from app.services import coding
from app.services.coding_problems import PROBLEMS, STARTERS, public_problem, reference
from test_interviews import script


def workspace(client, problems=None):
    ids = problems or ["pairs", "brackets"]
    with SessionLocal() as db:
        user = db.get(User, client.user_id)
        s = InterviewSession(user_id=user.id, tenant_id=user.tenant_id, kind="coding", role="Engineer", level="new_grad", difficulty="easy", persona_name="Karthik", persona_voice="cedar", status="active", planned_questions=1,
                             turns=[{"who": "interviewer", "text": "Talk me through your approach.", "kind": "question"}])
        db.add(s); db.flush()
        db.add(CodingWorkspace(session_id=s.id, problems=ids, active_index=0, version=0, solutions={pid: {"language": "python", "sources": {"python": STARTERS["python"]}} for pid in ids}))
        db.commit()
        return s.id


def save(client, sid, version=0, **values):
    return client.put(f"/api/interviews/{sid}/coding", json={"version": version, "problem_id": "pairs", "language": "python", "source": "print(1)", **values})


async def accepted(language, source, cases):
    return {"status": "accepted", "passed": len(cases), "total": len(cases), "cases": []}


def test_coding_start_uses_real_problem_and_assigned_interviewer(client, monkeypatch):
    calls = script(monkeypatch, [{"say": "I'm Karthik, your AI interviewer. Read the coding problem and describe your approach.", "kind": "question"}])
    response = client.post("/api/interviews", json={"kind": "coding", "difficulty": "hard", "coding_problems": 3, "coding_language": "java"})
    assert response.status_code == 200, response.text
    sid = response.json()["id"]
    assert response.json()["coding_enabled"] and response.json()["interviewer"]["name"] == "Karthik"
    ws = client.get(f"/api/interviews/{sid}/coding").json()
    assert len(ws["problems"]) == 3 and ws["solutions"][ws["problems"][0]["id"]]["language"] == "java"
    assert ws["problems"][0]["title"] in calls[0][1]
    assert "SAVED CODING WORKSPACE" in calls[0][1]
    assert "cases" not in ws["problems"][0] and "examples" in ws["problems"][0]


def test_source_versions_languages_and_ownership(client, make_user):
    sid = workspace(client); other = make_user()
    assert other.get(f"/api/interviews/{sid}/coding").status_code == 404
    assert save(other, sid).status_code == 404
    assert save(client, sid).json()["version"] == 1
    assert save(client, sid).status_code == 409
    assert save(client, sid, 1, problem_id="brackets").status_code == 409
    assert save(client, sid, 1, language="bash").status_code == 422
    assert save(client, sid, 1, source="x" * 50001).status_code == 422
    assert save(client, sid, 1, language="javascript", source="console.log(1)").status_code == 200
    data = client.get(f"/api/interviews/{sid}/coding").json()
    assert data["solutions"]["pairs"]["sources"] == {"python": "print(1)", "javascript": "console.log(1)"}


def test_saved_run_is_snapshot_and_stale_code_cannot_advance(client, monkeypatch):
    monkeypatch.setattr(coding, "execute", accepted)
    sid = workspace(client)
    save(client, sid)
    assert client.post(f"/api/interviews/{sid}/coding/run", json={"version": 0}).status_code == 409
    result = client.post(f"/api/interviews/{sid}/coding/run", json={"version": 1, "mode": "submit"}).json()
    assert result["status"] == "accepted" and result["mode"] == "submit"
    save(client, sid, 1, source="print(2)")
    assert client.post(f"/api/interviews/{sid}/coding/next", json={"version": 2}).status_code == 409
    next_ws = client.post(f"/api/interviews/{sid}/coding/next", json={"version": 2, "skip": True}).json()
    assert next_ws["active_index"] == 1 and next_ws["version"] == 3
    with SessionLocal() as db:
        record = db.get(CodingRun, result["id"])
        assert record.source == "print(1)" and record.source_hash == coding.source_hash("print(1)")
        session = db.get(InterviewSession, sid)
        assert "Skipped" in session.turns[-2]["text"]
    assert client.post(f"/api/interviews/{sid}/coding/next", json={"version": 3}).status_code == 409


def test_examples_do_not_unlock_next_and_full_suite_does(client, monkeypatch):
    monkeypatch.setattr(coding, "execute", accepted)
    sid = workspace(client)
    assert client.post(f"/api/interviews/{sid}/coding/run", json={"version": 0, "mode": "examples"}).status_code == 200
    assert client.post(f"/api/interviews/{sid}/coding/next", json={"version": 0}).status_code == 409
    assert client.post(f"/api/interviews/{sid}/coding/run", json={"version": 0, "mode": "submit"}).status_code == 200
    assert client.post(f"/api/interviews/{sid}/coding/next", json={"version": 0}).status_code == 200


def test_provider_failure_keeps_source_and_records_unavailability(client, monkeypatch):
    monkeypatch.setattr(settings, "code_runner_url", "")
    sid = workspace(client); save(client, sid)
    response = client.post(f"/api/interviews/{sid}/coding/run", json={"version": 1})
    assert response.status_code == 503
    data = client.get(f"/api/interviews/{sid}/coding").json()
    assert data["solutions"]["pairs"]["sources"]["python"] == "print(1)"
    assert data["runs"][0]["status"] == "unavailable"


def test_ai_sees_saved_code_and_run_evidence_and_does_not_rush(client, monkeypatch):
    sid = workspace(client); save(client, sid, source="# candidate-code\nprint(2)")
    calls = script(monkeypatch, [{"say": "We are finished", "kind": "closing"}])
    response = client.post(f"/api/interviews/{sid}/answer", json={"text": "I need time to implement this"})
    assert response.status_code == 200 and response.json()["done"] is False
    assert "candidate-code" in calls[0][1] and PROBLEMS["pairs"]["title"] in calls[0][1]
    assert "current coding problem" in response.json()["say"]


def test_technical_ai_can_open_workspace(client, monkeypatch):
    sid = workspace(client)
    with SessionLocal() as db:
        db.delete(db.get(CodingWorkspace, sid)); db.get(InterviewSession, sid).kind = "technical"; db.commit()
    script(monkeypatch, [{"say": "Let's code", "kind": "question", "workspace": "coding", "coding_problem": "brackets"}])
    response = client.post(f"/api/interviews/{sid}/answer", json={"text": "I would use a hash map, and I can implement it"})
    assert response.status_code == 200 and response.json()["coding_enabled"]
    assert client.get(f"/api/interviews/{sid}").json()["coding_enabled"]
    assert client.get(f"/api/interviews/{sid}/coding").json()["problems"][0]["id"] == "brackets"
    assert PROBLEMS["brackets"]["constraints"] in response.json()["say"]


def test_code_only_report_and_read_only_after_finish(client, monkeypatch):
    sid = workspace(client); save(client, sid, source="# actual solution\nprint(2)")
    calls = script(monkeypatch, [])
    response = client.post(f"/api/interviews/{sid}/finish")
    assert response.status_code == 200, response.text
    assert "actual solution" in calls[0][1]
    assert save(client, sid, 1).status_code == 409
    assert client.post(f"/api/interviews/{sid}/coding/run", json={"version": 1}).status_code == 409
    assert client.get(f"/api/interviews/{sid}/coding").status_code == 200


def test_coding_artifacts_deleted_with_session(client, monkeypatch):
    monkeypatch.setattr(coding, "execute", accepted)
    sid = workspace(client)
    client.post(f"/api/interviews/{sid}/coding/run", json={"version": 0})
    assert client.delete(f"/api/interviews/{sid}").status_code == 204
    with SessionLocal() as db:
        assert db.get(CodingWorkspace, sid) is None
        assert db.scalar(select(func.count()).select_from(CodingRun).where(CodingRun.session_id == sid)) == 0


def test_admin_can_read_but_cannot_inject_code(client, make_user):
    sid = workspace(client); admin = make_user()
    with SessionLocal() as db: db.get(User, admin.user_id).is_platform_admin = True; db.commit()
    assert admin.get(f"/api/interviews/{sid}/coding").status_code == 200
    assert save(admin, sid).status_code == 404


@pytest.mark.asyncio
async def test_grading_is_server_owned_and_hidden_cases_are_private(monkeypatch):
    cases = PROBLEMS["pairs"]["cases"]
    outputs = [{"status": "ok", "stdout": c["expected"], "stderr": c["input"], "duration_ms": 1} for c in cases]
    outputs[-1]["stdout"] = "incorrect"
    transport = httpx.MockTransport(lambda req: httpx.Response(200, json={"status": "finished", "cases": outputs, "passed": 999}))
    original = httpx.AsyncClient
    monkeypatch.setattr(coding.httpx, "AsyncClient", partial(original, transport=transport))
    monkeypatch.setattr(settings, "code_runner_url", "http://runner")
    monkeypatch.setattr(settings, "code_runner_token", "test-token")
    result = await coding.execute("python", "print(0)", cases)
    assert result["passed"] == len(cases) - 1 and result["status"] == "failed"
    for row in result["cases"]:
        if row["hidden"]: assert not {"input", "expected", "output", "stderr"} & row.keys()


def test_problem_catalog_has_edge_cases_and_correct_reference_values():
    assert len(PROBLEMS) == 9
    assert reference("pairs", "4 4\n2 2 2 2\n") == "6"
    assert reference("subarray", "3\n-8 -2 -5\n") == "-2"
    assert reference("intervals", "2\n1 2\n2 4\n") == "1\n1 4"
    assert reference("window", "aaabcbc\naabc\n") == "4"
    assert reference("unique", "abba\n") == "2"
    assert reference("path", "1 0 0 0\n") == "0"
    for pid, p in PROBLEMS.items():
        assert len(p["cases"]) >= 6 and sum(c["hidden"] for c in p["cases"]) >= 4
        assert len(public_problem(pid)["examples"]) == 2
        assert "cases" not in public_problem(pid)


def test_controller_auth_and_fixed_sandbox_configuration(monkeypatch):
    import importlib.util
    from fastapi.testclient import TestClient
    spec = importlib.util.spec_from_file_location("code_controller", Path(__file__).parents[2] / "runner/controller.py")
    controller = importlib.util.module_from_spec(spec); spec.loader.exec_module(controller)
    monkeypatch.setenv("RUNNER_TOKEN", "runner-secret")
    specs = []
    payload = json.dumps({"status": "finished", "cases": [{"status": "ok", "stdout": "2", "stderr": "", "duration_ms": 1}]}).encode()
    def handler(request):
        if request.url.path.endswith("/create"):
            specs.append(json.loads(request.content)); return httpx.Response(201, json={"Id": "test-container"})
        if request.url.path.endswith("/wait"): return httpx.Response(200, json={"StatusCode": 0})
        if request.url.path.endswith("/logs"): return httpx.Response(200, content=b"\x01\x00\x00\x00" + len(payload).to_bytes(4, "big") + payload)
        return httpx.Response(204)
    original = httpx.AsyncClient
    monkeypatch.setattr(controller.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler)))
    with TestClient(controller.app) as client:
        assert client.post("/execute", json={"language": "python", "source": "x", "inputs": ["1"]}).status_code == 403
        r = client.post("/execute", headers={"X-Runner-Token": "runner-secret"}, json={"language": "python", "source": "print(2)", "inputs": ["1"]})
        assert r.status_code == 200 and r.json()["status"] == "finished"
    sandbox = specs[0]
    assert sandbox["User"] == "65534:65534" and sandbox["Image"] == "hirepilot-code-runtime:local"
    assert sandbox["HostConfig"]["NetworkMode"] == "none" and sandbox["HostConfig"]["ReadonlyRootfs"]
    assert sandbox["HostConfig"]["CapDrop"] == ["ALL"] and sandbox["HostConfig"]["PidsLimit"] == 64
    assert "Binds" not in sandbox["HostConfig"] and "Privileged" not in sandbox["HostConfig"]
