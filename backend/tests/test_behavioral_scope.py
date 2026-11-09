import pytest

from app.services.interview_scope import BEHAVIORAL_POLICY, guard
from test_interviews import parse_sse, script, script_stream, start


@pytest.mark.parametrize("question", [
    "Implement a binary search algorithm.",
    "What is polymorphism?",
    "Explain the time complexity of binary search.",
    "Design a distributed system for our application.",
    "Write an SQL query for this table.",
    "Walk me through the implementation of your service.",
    "How did you implement the cache?",
])
def test_explicit_technical_questions_are_replaced(question):
    say, changed = guard(question, {"kind": "question"})
    assert changed and "time you took ownership" in say


@pytest.mark.parametrize("question", [
    "Tell me about a time you handled a Redis outage. How did you communicate with your team?",
    "Describe a situation when you disagreed about an algorithm. How did you resolve the disagreement?",
    "What did you personally do to help the team during that database incident?",
    "How did the feedback change your approach?",
    "This session is behavioral, so we won't switch to a coding challenge. What did you learn from that disagreement?",
])
def test_engineering_context_is_allowed_without_changing_round(question):
    assert guard(question, {"kind": "chat"}) == (question, False)


def test_opening_does_not_start_a_technical_exercise(client, monkeypatch):
    script(monkeypatch, [{"say": "Let's write an algorithm.", "kind": "question", "workspace": "coding"}])
    response = start(client)
    assert response.status_code == 200
    data = response.json()
    assert "time you took ownership" in data["turns"][0]["text"]
    assert not data["coding_enabled"]
    assert client.get(f"/api/interviews/{data['id']}/coding").status_code == 404


def test_candidate_technical_context_is_understood_and_preserved(client, monkeypatch):
    calls = script(monkeypatch, [{"say": "Tell me about a disagreement.", "kind": "question"},
                               {"say": "How did you help your teammate understand your concern?", "kind": "followup", "score": 4}])
    sid = start(client).json()["id"]
    answer = "We disagreed about Redis caching. I explained the failure risk and asked my teammate to review it together."
    response = client.post(f"/api/interviews/{sid}/answer", json={"text": answer})
    assert response.json()["kind"] == "followup"
    assert BEHAVIORAL_POLICY in calls[-1][1] and answer in calls[-1][1]
    assert client.get(f"/api/interviews/{sid}").json()["turns"][1]["text"] == answer


def test_behavioral_stream_never_speaks_unvalidated_technical_question(client, monkeypatch):
    script(monkeypatch, [{"say": "Tell me about a disagreement.", "kind": "question"}])
    sid = start(client).json()["id"]
    script_stream(monkeypatch, [["Now implement ", 'a binary search algorithm.\n===META===\n{"kind":"question","workspace":"coding"}']])
    events = parse_sse(client.post(f"/api/interviews/{sid}/answer/stream", json={"text": "I used an algorithm in the project."}).text)
    spoken = "".join(e["text"] for e in events if e["t"] == "delta")
    assert "binary search" not in spoken and "disagreement" in spoken
    assert spoken == events[-1]["say"] and not events[-1]["coding_enabled"]


def test_behavioral_report_uses_behavioral_judgment_not_algorithm_depth(client, monkeypatch):
    calls = script(monkeypatch, [{"say": "Tell me about a time you owned a mistake.", "kind": "question"},
                               {"say": "What did you learn?", "kind": "followup", "score": 3}])
    sid = start(client).json()["id"]
    client.post(f"/api/interviews/{sid}/answer", json={"text": "I missed a deadline and told my team early, then changed how I planned."})
    assert client.post(f"/api/interviews/{sid}/finish").status_code == 200
    assert "Judge depth as decision-making" in calls[-1][1]
