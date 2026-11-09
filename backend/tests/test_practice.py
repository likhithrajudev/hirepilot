from app.services import coding


def test_library_lists_real_problems_with_progress_and_runs_are_recorded(client, monkeypatch):
    r = client.get("/api/practice/problems").json()
    assert r["progress"]["total"] == len(r["problems"]) >= 9 and r["progress"]["solved"] == 0
    pid = r["problems"][0]["id"]
    detail = client.get(f"/api/practice/problems/{pid}").json()
    assert detail["statement"] and "cases" not in detail and set(detail["starters"]) == {"python", "javascript", "cpp", "java"} and detail["attempts"] == []
    assert client.get("/api/practice/problems/nope").status_code == 404

    calls = []

    async def fake(language, source, cases):
        calls.append(len(cases))
        return {"status": "accepted", "passed": len(cases), "total": len(cases), "cases": []}

    monkeypatch.setattr(coding, "execute", fake)
    assert client.post(f"/api/practice/problems/{pid}/run", json={"language": "python", "source": "print(1)", "mode": "examples"}).status_code == 200
    assert client.get("/api/practice/problems").json()["progress"]["solved"] == 0, "running the examples does not solve a problem"
    assert client.post(f"/api/practice/problems/{pid}/run", json={"language": "python", "source": "print(1)", "mode": "submit"}).json()["status"] == "accepted"
    assert calls[1] > calls[0], "a submission also runs the hidden cases"
    after = client.get("/api/practice/problems").json()
    assert after["progress"]["solved"] == 1 and next(p for p in after["problems"] if p["id"] == pid)["status"] == "solved"
    assert len(client.get(f"/api/practice/problems/{pid}").json()["attempts"]) == 2


def test_unavailable_runner_records_nothing_and_input_is_validated(client, monkeypatch):
    from fastapi import HTTPException

    async def down(*a, **k):
        raise HTTPException(503, "The isolated code runner is unavailable.")

    monkeypatch.setattr(coding, "execute", down)
    pid = client.get("/api/practice/problems").json()["problems"][0]["id"]
    assert client.post(f"/api/practice/problems/{pid}/run", json={"language": "python", "source": "x"}).status_code == 503
    assert client.get(f"/api/practice/problems/{pid}").json()["attempts"] == []
    assert client.post(f"/api/practice/problems/{pid}/run", json={"language": "cobol", "source": "x"}).status_code == 422
    assert client.post(f"/api/practice/problems/{pid}/run", json={"language": "python", "source": "   "}).status_code == 422
