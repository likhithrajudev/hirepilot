from datetime import datetime, timedelta, timezone

from app.db import SessionLocal
from app.models import Contest, User
from app.services import coding


def admin_of(c):
    with SessionLocal() as db:
        db.get(User, c.user_id).is_platform_admin = True
        db.commit()


def new_contest(c, start_in_min=-10, **kw):
    body = {"name": "Weekly Sprint", "kind": "weekly", "starts_at": (datetime.now(timezone.utc) + timedelta(minutes=start_in_min)).isoformat(), "duration_min": 90, "problem_ids": ["pairs", "brackets"], **kw}
    return c.post("/api/contests", json=body)


def test_only_admins_create_contests_and_states_are_listed(client, make_user):
    assert new_contest(client).status_code == 403
    admin_of(client)
    assert new_contest(client, problem_ids=["nope"]).status_code == 422
    assert new_contest(client, problem_ids=["pairs", "pairs"]).status_code == 422
    live = new_contest(client).json(); up = new_contest(client, start_in_min=120, name="Next one").json(); past = new_contest(client, start_in_min=-300, name="Old one").json()
    assert (live["state"], up["state"], past["state"]) == ("live", "upcoming", "ended")
    other = make_user()
    listing = other.get("/api/contests").json()
    ids = lambda k: [x["id"] for x in listing[k]]   # the test database is shared, so other tests' contests may be listed too
    assert live["id"] in ids("live") and up["id"] in ids("upcoming") and past["id"] in ids("past") and up["id"] not in ids("live") and listing["can_create"] is False
    assert other.get(f"/api/contests/{up['id']}").json()["problems"] == [], "problems stay hidden until the start"
    assert len(other.get(f"/api/contests/{live['id']}").json()["problems"]) == 2


def test_registering_running_and_ranking(client, make_user, monkeypatch):
    admin_of(client)
    live = new_contest(client).json()
    up = new_contest(client, start_in_min=60, name="Later").json()
    assert client.post(f"/api/contests/{up['id']}/register").status_code == 204 and client.post(f"/api/contests/{up['id']}/register").status_code == 204
    count = lambda: next(x for x in client.get("/api/contests").json()["upcoming"] if x["id"] == up["id"])["registered_count"]
    assert count() == 1
    assert client.delete(f"/api/contests/{up['id']}/register").status_code == 204 and count() == 0
    assert client.delete(f"/api/contests/{live['id']}/register").status_code == 409, "cannot leave a running contest"

    verdict = {"status": "accepted"}

    async def fake(language, source, cases):
        ok = verdict["status"] == "accepted"
        return {"status": verdict["status"], "passed": len(cases) if ok else 0, "total": len(cases), "cases": []}

    monkeypatch.setattr(coding, "execute", fake)
    run = lambda c, pid="pairs", mode="submit": c.post(f"/api/contests/{live['id']}/problems/{pid}/run", json={"language": "python", "source": "x", "mode": mode})
    assert run(client, "window").status_code == 404, "not part of the contest"
    a, b = client, make_user()
    verdict["status"] = "failed"; assert run(b).status_code == 200
    verdict["status"] = "accepted"; assert run(b).status_code == 200 and run(a).status_code == 200 and run(a, "brackets").status_code == 200
    assert run(a, "brackets", "examples").status_code == 200
    rows = a.get(f"/api/contests/{live['id']}/standings").json()["rows"]
    assert [r["rank"] for r in rows] == [1, 2] and rows[0]["you"] is True and rows[0]["score"] == 20 and rows[1]["score"] == 10
    assert rows[1]["cells"][0]["wrong"] == 1 and rows[1]["penalty"] >= 5, "a wrong submission before the solve costs penalty minutes"
    assert run(a).status_code == 200 and a.get(f"/api/contests/{live['id']}/standings").json()["rows"][0]["score"] == 20, "solving again changes nothing"
    mine = a.get(f"/api/contests/{live['id']}").json()["problems"]
    assert {p["id"]: p["status"] for p in mine} == {"pairs": "solved", "brackets": "solved"}

    with SessionLocal() as db:
        c = db.get(Contest, live["id"]); c.starts_at = datetime.now(timezone.utc) - timedelta(hours=5); db.commit()
    assert run(a).status_code == 409, "an ended contest accepts no submissions"
