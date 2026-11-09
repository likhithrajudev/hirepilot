import pytest

from app.routers import interviews as iv

from test_billing import upgrade


def script(monkeypatch, replies, report=None):
    """Replace the model with a scripted interviewer so tests are deterministic and free."""
    calls = []
    queue = list(replies)

    async def fake(db, system, prompt, temperature=0.3):
        calls.append((system, prompt))
        if system is iv.REPORT:
            return report or {"overall": 72, "verdict": "good", "summary": "ok", "dimensions": {"communication": {"score": 9, "comment": "c"}},
                              "strengths": ["a"], "improvements": ["b"], "questions": [{"question": "Q1", "score": 4, "feedback": "f", "strong_answer_covers": ["x"]}], "practice_plan": ["p"]}
        return queue.pop(0)

    monkeypatch.setattr(iv, "json_chat", fake)
    return calls


def start(client, **kw):
    return client.post("/api/interviews", json={"kind": "behavioral", "questions": 3, **kw})


def test_full_interview_flow_hides_scores_and_produces_a_report(client, monkeypatch):
    calls = script(monkeypatch, [
        {"say": "Hi, tell me about a project you owned.", "kind": "question"},
        {"say": "What was your exact part?", "kind": "followup", "score": 2, "note": "vague"},
        {"say": "Okay. Describe a disagreement.", "kind": "question", "score": 4, "note": "specific"},
        {"say": "Last one: a failure.", "kind": "question", "score": 3, "note": "ok"},
        {"say": "Thanks. Anything you want to ask me or add before we finish?", "kind": "wrapup", "score": 5, "note": "great"},
        {"say": "Great question. Good luck with everything!", "kind": "closing"},
    ])
    s = start(client, minutes=9).json()
    assert s["status"] == "active" and s["turns"][0]["who"] == "interviewer" and s["duration_min"] == 9
    for text in ("I built a thing", "I wrote the backend", "We disagreed on the API", "A failed launch"):
        r = client.post(f"/api/interviews/{s['id']}/answer", json={"text": text}).json()
    assert r["kind"] == "wrapup" and r["done"] is False, "the candidate gets the floor before the interview ends"
    r = client.post(f"/api/interviews/{s['id']}/answer", json={"text": "Thanks, what is the team like?"}).json()
    assert r["done"] is True and r["kind"] == "closing"
    full = client.get(f"/api/interviews/{s['id']}").json()
    assert all(set(t) <= {"who", "text", "at", "smalltalk", "kind"} for t in full["turns"]), "private scores must not leak to the candidate"
    rep = client.post(f"/api/interviews/{s['id']}/finish").json()["report"]
    assert rep["overall"] == 72 and rep["dimensions"]["communication"]["score"] == 5, "scores are clamped to 1-5"
    assert rep["dimensions"]["depth"]["score"] == 3, "missing dimensions get a neutral default"
    assert client.post(f"/api/interviews/{s['id']}/finish").json()["overall"] == 72  # idempotent, no second model call


def test_cannot_answer_after_the_end(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}, {"say": "Anything to add?", "kind": "closing", "score": 3, "note": ""}, {"say": "Bye!", "kind": "closing"}])
    sid = start(client).json()["id"]
    first = client.post(f"/api/interviews/{sid}/answer", json={"text": "a"}).json()
    assert first["kind"] == "wrapup" and first["done"] is False, "a closing line first becomes an invitation to add anything"
    assert client.post(f"/api/interviews/{sid}/answer", json={"text": "no, thanks"}).json()["done"] is True
    assert client.post(f"/api/interviews/{sid}/answer", json={"text": "b"}).status_code == 409


def test_wrapup_replies_are_never_scored_and_never_reopen_the_interview(client, monkeypatch):
    script(monkeypatch, [
        {"say": "Q1?", "kind": "question"},
        {"say": "Before we finish, anything to add?", "kind": "wrapup", "score": 4, "note": "good", "heard": "I built a thing."},
        {"say": "Happy to say. Another question for me?", "kind": "chat"},
        {"say": "Next question!", "kind": "question"},      # a misbehaving model must not restart the interview
    ])
    sid = start(client).json()["id"]
    client.post(f"/api/interviews/{sid}/answer", json={"text": "I built a thing"})
    r1 = client.post(f"/api/interviews/{sid}/answer", json={"text": "What is the team like?"}).json()
    assert r1["kind"] == "chat" and r1["done"] is False
    r2 = client.post(f"/api/interviews/{sid}/answer", json={"text": "And the stack?"}).json()
    assert r2["kind"] == "closing" and r2["done"] is True, "after the invitation only a reply or the goodbye is possible"
    s = client.get(f"/api/interviews/{sid}").json()
    assert s["answered"] == 1, "what the candidate said after the invitation is not an interview answer"


def test_reply_parser_never_leaks_the_marker_in_any_spelling():
    for raw in ('Nice one. What next?\n===META===\n{"kind": "question", "score": 4}',
                'Nice one. What next?\nMETA === {"kind": "question", "score": 4}',
                'Nice one. What next?\n=== META ===\n{"kind": "question", "score": 4}',
                'Nice one. What next?\n{"kind": "question", "score": 4}'):
        say, meta = iv._split_reply(raw)
        assert say == "Nice one. What next?" and meta == {"kind": "question", "score": 4}, raw
    assert iv._split_reply("We use metadata and meta-analysis daily.") == ("We use metadata and meta-analysis daily.", {}), "ordinary words are untouched"
    assert iv._split_reply("Just words.") == ("Just words.", {})
    say, meta = iv._split_reply("Cut off\nMETA === {\"kind\": \"que")
    assert say == "Cut off" and meta == {}, "a truncated block is dropped, not shown"


def test_streamed_reply_with_a_misspelled_marker_never_shows_json(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    sid = start(client).json()["id"]
    script_stream(monkeypatch, [["Good, ", "that makes sense. What was hardest?\nME", 'TA === {"kind": "followup", "score": 4, "heard": "I fixed it."}']])
    ev = parse_sse(client.post(f"/api/interviews/{sid}/answer/stream", json={"text": "I fixed it"}).text)
    shown = "".join(e["text"] for e in ev if e["t"] == "delta")
    assert "META" not in shown and "{" not in shown and shown.strip() == "Good, that makes sense. What was hardest?"
    assert ev[-1]["t"] == "done" and ev[-1]["kind"] == "followup" and "META" not in ev[-1]["say"]



def test_followups_are_capped_and_the_planned_count_forces_a_close(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}] + [{"say": "more?", "kind": "followup", "score": 2, "note": ""}] * 4)
    sid = start(client, questions=3).json()["id"]
    kinds = [client.post(f"/api/interviews/{sid}/answer", json={"text": "x"}).json()["kind"] for _ in range(4)]
    assert kinds == ["followup", "followup", "followup", "question"], "fourth follow-up is converted to the next question"


def test_report_needs_an_answer_and_sessions_are_private(client, anon, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    sid = start(client).json()["id"]
    assert client.post(f"/api/interviews/{sid}/finish").status_code == 409
    from conftest import signup
    _, other = signup(anon)
    anon.headers["Authorization"] = f"Bearer {other['access_token']}"
    assert anon.get(f"/api/interviews/{sid}").status_code == 404
    assert anon.post(f"/api/interviews/{sid}/answer", json={"text": "hi"}).status_code == 404
    assert anon.delete(f"/api/interviews/{sid}").status_code == 404


def test_monthly_limit_refund_on_failure_and_resume_validation(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    assert start(client).status_code == 200  # Cadet: 2 credits a month, a voice interview costs 2
    r = start(client)
    assert r.status_code == 402 and r.json()["detail"]["feature"] == "interview"
    upgrade(client, "pilot")

    async def boom(*a, **k):
        from fastapi import HTTPException
        raise HTTPException(502, "provider down")

    monkeypatch.setattr(iv, "json_chat", boom)
    before = client.get("/api/billing/subscription").json()["usage"]["interview"]["used"]
    assert start(client).status_code == 502
    assert client.get("/api/billing/subscription").json()["usage"]["interview"]["used"] == before, "a failed start is refunded"
    assert start(client, kind="resume").status_code == 422, "resume deep dive needs a resume"
    assert start(client, resume_id=999999).status_code == 404


def test_answer_survives_a_model_failure_so_the_candidate_can_retry(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    sid = start(client).json()["id"]

    async def boom(*a, **k):
        from fastapi import HTTPException
        raise HTTPException(504, "slow")

    monkeypatch.setattr(iv, "json_chat", boom)
    assert client.post(f"/api/interviews/{sid}/answer", json={"text": "my answer"}).status_code == 504
    assert [t["who"] for t in client.get(f"/api/interviews/{sid}").json()["turns"]] == ["interviewer", "candidate"]
    script(monkeypatch, [{"say": "Thanks. Tell me more.", "kind": "followup", "score": 3, "note": ""}])
    assert client.post(f"/api/interviews/{sid}/answer", json={"text": "my answer, retried"}).status_code == 200, "a retry after a failure must go through"
    turns = client.get(f"/api/interviews/{sid}").json()["turns"]
    assert [t["who"] for t in turns] == ["interviewer", "candidate", "interviewer"] and turns[1]["text"] == "my answer, retried", "the failed attempt is replaced, not duplicated"


def test_interviewer_has_one_persona_whose_name_is_in_the_prompt_and_voice_matches_gender(client, monkeypatch):
    calls = script(monkeypatch, [{"say": "Hi, I'm X. Q1?", "kind": "question"}])
    s = start(client).json()
    who = s["interviewer"]
    assert who["name"] in {"Ananya", "Meera", "Priya", "Arjun", "Rohan", "Karthik"} and who["gender"] in ("female", "male")
    assert f"Your name is {who['name']}" in calls[0][1], "the model is told its name"
    assert client.get(f"/api/interviews/{s['id']}").json()["interviewer"] == who, "stable for the whole interview"
    female = {"marin", "sage", "coral"}
    assert (who["voice"] in female) == (who["gender"] == "female")


def test_audio_endpoint_only_speaks_your_own_interviewer_turns(client, anon, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}, {"say": "Q2?", "kind": "question", "score": 3, "note": ""}])
    seen = {}

    class FakeSpeech:
        async def create(self, **kw):
            seen.update(kw)
            return type("R", (), {"content": b"ID3fake-mp3"})()

    class FakeClient:
        def __init__(self, *a, **k):
            self.audio = type("A", (), {"speech": FakeSpeech()})()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", FakeClient)
    client.put("/api/settings", json={"openai_api_key": "sk-test-own-key-1234"})
    sid = start(client).json()["id"]
    client.post(f"/api/interviews/{sid}/answer", json={"text": "my answer"})
    r = client.post(f"/api/interviews/{sid}/turns/0/audio")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3fake-mp3"
    assert seen["input"] == "Q1?" and seen["voice"] in {"marin", "sage", "cedar", "verse", "ash"} and "video call" in seen["instructions"]
    assert client.post(f"/api/interviews/{sid}/turns/1/audio").status_code == 404, "candidate turns are never synthesised"
    assert client.post(f"/api/interviews/{sid}/turns/99/audio").status_code == 404
    from conftest import signup
    _, other = signup(anon)
    anon.headers["Authorization"] = f"Bearer {other['access_token']}"
    assert anon.post(f"/api/interviews/{sid}/turns/0/audio").status_code == 404


def test_integrity_events_are_opt_in_validated_capped_and_scored(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}, {"say": "Q1?", "kind": "question"}])
    plain = start(client).json()
    assert plain["integrity"] == {"monitored": False} and plain["proctored"] is False
    assert client.post(f"/api/interviews/{plain['id']}/events", json={"events": [{"type": "paste"}]}).status_code == 204
    assert client.get(f"/api/interviews/{plain['id']}").json()["integrity"] == {"monitored": False}, "nothing is recorded without consent"

    upgrade(client, "pilot")
    s = start(client, proctored=True).json()
    assert s["proctored"] is True and s["integrity"]["score"] == 100 and s["integrity"]["status"] == "clean"
    evs = [{"type": "tab_hidden", "ms": 4000}, {"type": "paste"}, {"type": "gaze_away", "ms": 10000}, {"type": "not_a_real_type"}, {"type": "multi_screen"}]
    assert client.post(f"/api/interviews/{s['id']}/events", json={"events": evs}).status_code == 204
    i = client.get(f"/api/interviews/{s['id']}").json()["integrity"]
    assert i["counts"] == {"tab_hidden": 1, "paste": 1, "gaze_away": 1, "multi_screen": 1}, "unknown types are dropped"
    assert i["away_seconds"] == 14 and i["status"] == "review" and 0 <= i["score"] < 85
    assert "not proof" in i["note"]
    assert client.post(f"/api/interviews/{s['id']}/events", json={"events": [{"type": "paste", "ms": -5}]}).status_code == 422
    for _ in range(12):
        client.post(f"/api/interviews/{s['id']}/events", json={"events": [{"type": "copy"}] * 50})
    assert sum(client.get(f"/api/interviews/{s['id']}").json()["integrity"]["counts"].values()) <= 400, "event log is capped"


def test_other_users_cannot_write_events(client, anon, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    sid = start(client, proctored=True).json()["id"]
    from conftest import signup
    _, other = signup(anon)
    anon.headers["Authorization"] = f"Bearer {other['access_token']}"
    assert anon.post(f"/api/interviews/{sid}/events", json={"events": [{"type": "paste"}]}).status_code == 404


# ───────── streaming, small talk, transcription ─────────
def script_stream(monkeypatch, chunks_per_turn):
    """Scripted token stream: each call yields the next list of chunks."""
    queue = list(chunks_per_turn)

    async def fake(db, system, prompt, temperature=0.6):
        assert iv.META in system, "the streaming prompt must ask for the meta marker"
        for c in queue.pop(0):
            yield c

    monkeypatch.setattr(iv, "stream_chat", fake)


def parse_sse(text):
    import json
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


def test_streamed_answer_emits_text_before_done_and_never_leaks_the_marker(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    sid = start(client).json()["id"]
    # the marker is split across chunks on purpose
    script_stream(monkeypatch, [["Nice, that ", "sounds solid. What was the hard", "est part?\n===ME", 'TA===\n{"kind": "followup", "score": 4, "note": "good"}']])
    r = client.post(f"/api/interviews/{sid}/answer/stream", json={"text": "I built a tracker"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    ev = parse_sse(r.text)
    text = "".join(e["text"] for e in ev if e["t"] == "delta")
    assert text.strip() == "Nice, that sounds solid. What was the hardest part?" and "META" not in text
    done = ev[-1]
    assert done["t"] == "done" and done["kind"] == "followup" and done["say"].strip() == text.strip() and done["done"] is False
    turns = client.get(f"/api/interviews/{sid}").json()["turns"]
    assert [t["who"] for t in turns] == ["interviewer", "candidate", "interviewer"]


def test_stream_without_marker_still_works_and_errors_become_events(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    sid = start(client).json()["id"]
    script_stream(monkeypatch, [["Just text with no meta block."]])
    ev = parse_sse(client.post(f"/api/interviews/{sid}/answer/stream", json={"text": "a"}).text)
    assert ev[-1]["t"] == "done" and ev[-1]["kind"] == "question" and "Just text" in ev[-1]["say"]

    async def boom(db, system, prompt, temperature=0.6):
        from fastapi import HTTPException
        raise HTTPException(504, "slow model")
        yield  # pragma: no cover

    monkeypatch.setattr(iv, "stream_chat", boom)
    ev = parse_sse(client.post(f"/api/interviews/{sid}/answer/stream", json={"text": "b"}).text)
    assert ev[-1] == {"t": "error", "status": 504, "message": "slow model"}
    assert client.post(f"/api/interviews/{sid}/answer/stream", json={"text": "  "}).status_code == 422, "validation is a plain HTTP error"
    script_stream(monkeypatch, [["Recovered. Next question?\n===META===\n{\"kind\": \"question\"}"]])
    ev = parse_sse(client.post(f"/api/interviews/{sid}/answer/stream", json={"text": "b again"}).text)
    assert ev[-1]["t"] == "done", "retrying after a streamed failure works"


def test_small_talk_is_not_an_answer_and_is_not_scored(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}, {"say": "Doing well, thanks! Ready when you are.", "kind": "chat"}])
    sid = start(client).json()["id"]
    r = client.post(f"/api/interviews/{sid}/answer", json={"text": "Hey, how are you doing today?"}).json()
    assert r["kind"] == "chat" and r["done"] is False
    s = client.get(f"/api/interviews/{sid}").json()
    assert s["answered"] == 0 and s["progress"]["asked"] == 1, "small talk neither counts as an answer nor consumes a question"
    assert client.post(f"/api/interviews/{sid}/finish").status_code == 409, "a report needs a real answer"


def test_long_answers_are_accepted(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}, {"say": "Mm.", "kind": "followup", "score": 3, "note": ""}])
    sid = start(client).json()["id"]
    assert client.post(f"/api/interviews/{sid}/answer", json={"text": "word " * 3000}).status_code == 200, "15k characters must not be cut off"


def test_transcribe_sends_the_audio_with_a_do_not_censor_prompt(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    seen = {}

    class FakeTranscriptions:
        async def create(self, **kw):
            seen.update(kw)
            return type("R", (), {"text": " I fixed that damn bug myself. "})()

    class FakeClient:
        def __init__(self, *a, **k):
            self.audio = type("A", (), {"transcriptions": FakeTranscriptions()})()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", FakeClient)
    client.put("/api/settings", json={"openai_api_key": "sk-test-own-key-1234"})
    sid = start(client, role="Backend Engineer", company="Razorpay").json()["id"]
    audio = b"\x1aE\xdf\xa3" + b"0" * 4000
    r = client.post(f"/api/interviews/{sid}/transcribe?ms=6000", content=audio, headers={"content-type": "audio/webm;codecs=opus"})
    assert r.status_code == 200 and r.json() == {"text": "I fixed that damn bug myself."}
    name, data, ctype = seen["file"]
    assert name.endswith(".webm") and data == audio and ctype == "audio/webm"
    assert "Razorpay" in seen["prompt"] and "Backend" in seen["prompt"], "vocabulary only"
    assert "interview" not in seen["prompt"].lower() and seen["language"] == "en" and seen["temperature"] == 0, "no story for the model to continue from"
    assert client.post(f"/api/interviews/{sid}/transcribe", content=b"x" * 10, headers={"content-type": "audio/webm"}).json() == {"text": ""}, "silence/near-empty clips return nothing"
    assert client.post(f"/api/interviews/{sid}/transcribe", content=audio, headers={"content-type": "text/plain"}).status_code == 415


def test_speak_endpoint_is_for_your_active_interview_and_budgeted(client, anon, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])

    class FakeSpeech:
        async def create(self, **kw):
            return type("R", (), {"content": b"ID3x"})()

    class FakeClient:
        def __init__(self, *a, **k):
            self.audio = type("A", (), {"speech": FakeSpeech()})()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", FakeClient)
    client.put("/api/settings", json={"openai_api_key": "sk-test-own-key-1234"})
    sid = start(client).json()["id"]
    assert client.post(f"/api/interviews/{sid}/speak", json={"text": "Nice. What did you build?"}).content == b"ID3x"
    assert client.post(f"/api/interviews/{sid}/speak", json={"text": "x" * 501}).status_code == 422
    iv._tts_used[sid] = iv._TTS_BUDGET - 3
    assert client.post(f"/api/interviews/{sid}/speak", json={"text": "too long for what is left"}).status_code == 429, "per-interview budget"
    from conftest import signup
    _, other = signup(anon)
    anon.headers["Authorization"] = f"Bearer {other['access_token']}"
    assert anon.post(f"/api/interviews/{sid}/speak", json={"text": "hi"}).status_code == 404


def test_speak_can_stream_raw_pcm_and_reports_provider_failure_as_http_error(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    seen = {}

    class Resp:
        async def iter_bytes(self, n):
            for i in range(3):
                yield bytes([i]) * 4800

    class CM:
        async def __aenter__(self):
            return Resp()

        async def __aexit__(self, *a):
            return False

    class Streaming:
        def create(self, **kw):
            seen.update(kw)
            if seen.get("fail"):
                raise AssertionError("unreachable")
            return CM()

    class FakeClient:
        def __init__(self, *a, **k):
            self.audio = type("A", (), {"speech": type("S", (), {"with_streaming_response": Streaming()})()})()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", FakeClient)
    client.put("/api/settings", json={"openai_api_key": "sk-test-own-key-1234"})
    sid = start(client, kind="system_design").json()["id"]
    r = client.post(f"/api/interviews/{sid}/speak?fmt=pcm", json={"text": "Right, tell me more about that."})
    assert r.status_code == 200 and r.headers["x-sample-rate"] == "24000" and len(r.content) == 3 * 4800
    assert seen["speed"] == 0.95, "the selected character pace must reach streaming TTS"
    assert seen["response_format"] == "pcm" and "video call" in seen["instructions"]

    class EmptyResp:
        async def iter_bytes(self, n):
            return
            yield  # pragma: no cover

    class EmptyCM(CM):
        async def __aenter__(self):
            return EmptyResp()

    Streaming.create = lambda self, **kw: EmptyCM()
    assert client.post(f"/api/interviews/{sid}/speak?fmt=pcm", json={"text": "Hello again."}).status_code == 502, "no audio is an HTTP error, so the app falls back to the browser voice"


def test_nonsense_and_mic_checks_are_not_answers_and_the_corrected_reading_is_kept(client, monkeypatch):
    calls = script(monkeypatch, [
        {"say": "What did you build?", "kind": "question"},
        {"say": "Sorry, I did not catch that. Could you say it again?", "kind": "chat", "heard": ""},
        {"say": "Interesting. What was hardest?", "kind": "followup", "score": 4, "note": "good", "heard": "I built a tracker with Kubernetes and FastAPI."},
        {"say": "Thanks, that is all.", "kind": "closing", "score": 4, "note": "good", "heard": "Scaling the API."},
    ])
    sid = start(client).json()["id"]
    r = client.post(f"/api/interviews/{sid}/answer", json={"text": "testing one two blah blah"}).json()
    assert r["kind"] == "chat"
    s = client.get(f"/api/interviews/{sid}").json()
    assert s["answered"] == 0 and s["progress"]["asked"] == 1 and s["turns"][1]["smalltalk"] is True, "nonsense is not an answer and does not use up a question"
    assert client.post(f"/api/interviews/{sid}/finish").status_code == 409, "a report needs a real answer"
    client.post(f"/api/interviews/{sid}/answer", json={"text": "I built a tracker with Cooper Netties and fast API"})
    client.post(f"/api/interviews/{sid}/answer", json={"text": "the scaling part"})
    third_prompt = calls[3][1]
    assert "[understood as: I built a tracker with Kubernetes and FastAPI.]" in third_prompt, "later turns see the corrected reading of earlier speech"
    assert "Cooper Netties" in third_prompt, "the raw transcript is kept too"
    assert client.get(f"/api/interviews/{sid}").json()["answered"] == 2


def test_transcription_prompt_carries_the_question_and_resume_vocabulary(client, monkeypatch):
    script(monkeypatch, [{"say": "Tell me about your Kubernetes work at Razorpay?", "kind": "question"}])
    seen = {}

    class T:
        async def create(self, **kw):
            seen.update(kw)
            return type("R", (), {"text": "ok"})()

    class C:
        def __init__(self, *a, **k):
            self.audio = type("A", (), {"transcriptions": T()})()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", C)
    client.put("/api/settings", json={"openai_api_key": "sk-test-own-key-1234"})
    rid = client.post("/api/resumes", json={"name": "r", "latex": r"\documentclass{article}\begin{document}Built FastAPI and PostgreSQL services on Kubernetes at Zomato.\end{document}"}).json()["id"]
    sid = start(client, resume_id=rid).json()["id"]
    client.post(f"/api/interviews/{sid}/transcribe", content=b"0" * 3000, headers={"content-type": "audio/webm"})
    p = seen["prompt"]
    assert "Kubernetes work at Razorpay" not in p, "the question is NOT sent: it made the model invent answers out of noise"
    assert "FastAPI" in p and "PostgreSQL" in p and "Zomato" in p, "resume vocabulary is included"


def test_the_interviewer_is_told_to_be_open_about_being_an_ai(client, monkeypatch):
    calls = script(monkeypatch, [{"say": "Hi, I'm Priya, your AI interviewer today. Tell me about a project.", "kind": "question"}])
    start(client)
    system, prompt = calls[0]
    assert "AI interviewer" in system and "Never claim to be human" in system, "presenting a person-like interviewer must not turn into pretending to be human"
    assert "as their AI interviewer" in prompt, "the opening line introduces itself as an AI"


def test_turn_check_judges_finished_versus_thinking_and_fails_safe(client, anon, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    sid = start(client).json()["id"]
    seen = []

    async def judge(db, system, prompt, temperature=0.3):
        seen.append((system, prompt))
        return {"complete": prompt.rstrip('"').endswith("outcome.")}

    monkeypatch.setattr(iv, "json_chat", judge)
    assert client.post(f"/api/interviews/{sid}/turn-check", json={"text": "I led the migration and the outcome."}).json() == {"complete": True, "available": True}
    assert client.post(f"/api/interviews/{sid}/turn-check", json={"text": "I led the migration and then"}).json() == {"complete": False, "available": True}
    assert "Q1?" in seen[0][1] and "prefer false" in seen[0][0], "the check sees the question and leans toward waiting"

    async def boom(*a, **k):
        from fastapi import HTTPException
        raise HTTPException(504, "slow")

    monkeypatch.setattr(iv, "json_chat", boom)
    assert client.post(f"/api/interviews/{sid}/turn-check", json={"text": "anything"}).json() == {"complete": False, "available": False}, "a failed check keeps listening"
    iv._turn_checks[sid] = iv._TURN_CHECK_BUDGET
    monkeypatch.setattr(iv, "json_chat", judge)
    assert client.post(f"/api/interviews/{sid}/turn-check", json={"text": "outcome."}).json() == {"complete": False, "available": False}, "per-interview budget"
    from conftest import signup
    _, other = signup(anon)
    anon.headers["Authorization"] = f"Bearer {other['access_token']}"
    assert anon.post(f"/api/interviews/{sid}/turn-check", json={"text": "hi"}).status_code == 404


def test_only_known_phantoms_are_dropped_and_real_short_replies_always_survive(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    texts = iter(["Thanks for watching!", "Thank you.", "Okay.", "Yeah", "Yes, I used PostgreSQL.", "Subtitles by the Amara.org community"])

    class T:
        async def create(self, **kw):
            return type("R", (), {"text": next(texts)})()

    class C:
        def __init__(self, *a, **k):
            self.audio = type("A", (), {"transcriptions": T()})()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", C)
    client.put("/api/settings", json={"openai_api_key": "sk-test-own-key-1234"})
    sid = start(client).json()["id"]
    audio, hdr = b"0" * 4000, {"content-type": "audio/webm"}
    say = lambda ms: client.post(f"/api/interviews/{sid}/transcribe?ms={ms}", content=audio, headers=hdr).json()["text"]
    assert say(900) == "", "a caption leftover from a short clip"
    assert say(900) == "Thank you.", "a real thank you must reach the interviewer, e.g. at the wrap-up"
    assert say(900) == "Okay." and say(900) == "Yeah", "short real replies are never dropped"
    assert say(900) == "Yes, I used PostgreSQL."
    assert say(900) == "", "subtitle credits"


def test_extra_integrity_signals_are_accepted_and_scored(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    sid = start(client, proctored=True).json()["id"]
    evs = [{"type": "cursor_left", "ms": 4000}, {"type": "shortcut", "detail": "ctrl+v"}, {"type": "window_resized"}, {"type": "focus_lost", "ms": 6000}, {"type": "reload"}]
    assert client.post(f"/api/interviews/{sid}/events", json={"events": evs}).status_code == 204
    i = client.get(f"/api/interviews/{sid}").json()["integrity"]
    assert set(i["counts"]) == {"cursor_left", "shortcut", "window_resized", "focus_lost", "reload"}
    assert i["away_seconds"] == 6 and i["score"] < 100


def test_every_interviewer_is_a_distinct_character_in_both_manner_and_voice(client, monkeypatch):
    names = {n for n, _, _ in iv.PERSONAS}
    assert names <= set(iv.CHARACTERS), "every persona has a written character"
    assert len({iv.CHARACTERS[n]["style"] for n in names}) == len(names) and len({iv.CHARACTERS[n]["voice"] for n in names}) == len(names)
    calls = script(monkeypatch, [{"say": "Hi, I'm X, your AI interviewer. Q1?", "kind": "question"}])
    s = start(client).json()
    name = s["interviewer"]["name"]
    system, prompt = calls[0]
    assert iv.CHARACTERS[name]["style"] in prompt, "the model is told who it is"
    assert "never invent facts about a past life" in prompt, "a character shapes manner, never a made-up biography"
    assert "Do not parrot" in system
    assert iv.CHARACTERS[name]["voice"] in iv.tts_style(name) and "video call" in iv.tts_style(name)


def test_voice_check_and_the_goodbye_can_still_be_spoken_after_the_interview_ends(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])

    class FakeSpeech:
        async def create(self, **kw):
            return type("R", (), {"content": b"ID3x"})()

    class FakeClient:
        def __init__(self, *a, **k):
            self.audio = type("A", (), {"speech": FakeSpeech()})()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", FakeClient)
    assert client.post("/api/interviews/voice-check").status_code == 400, "no key yet: the check says so instead of failing mid-interview"
    client.put("/api/settings", json={"openai_api_key": "sk-test-own-key-1234"})
    r = client.post("/api/interviews/voice-check")
    assert r.status_code == 200 and r.content == b"ID3x"
    sid = start(client).json()["id"]
    from app.db import SessionLocal
    from app.models import InterviewSession
    from datetime import datetime, timezone, timedelta
    with SessionLocal() as db:
        row = db.get(InterviewSession, sid)
        row.status, row.finished_at = "done", datetime.now(timezone.utc)
        db.commit()
    assert client.post(f"/api/interviews/{sid}/speak", json={"text": "Thank you, goodbye."}).status_code == 200, "the goodbye plays even though the interview just ended"
    with SessionLocal() as db:
        row = db.get(InterviewSession, sid)
        row.finished_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
    assert client.post(f"/api/interviews/{sid}/speak", json={"text": "Hello?"}).status_code == 409, "but not long after"


def test_transcription_drops_clips_with_no_real_speech_and_low_confidence_guesses(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}])
    calls = []
    answer = {"text": "Sure, I have always been fascinated by technology and how it can solve problems.", "logprobs": [type("L", (), {"logprob": -2.0})() for _ in range(12)]}

    class T:
        async def create(self, **kw):
            calls.append(kw)
            return type("R", (), answer)()

    class C:
        def __init__(self, *a, **k):
            self.audio = type("A", (), {"transcriptions": T()})()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", C)
    client.put("/api/settings", json={"openai_api_key": "sk-test-own-key-1234"})
    sid = start(client).json()["id"]
    audio = b"0" * 4000
    h = {"content-type": "audio/webm"}
    assert client.post(f"/api/interviews/{sid}/transcribe?ms=5000&voiced=200", content=audio, headers=h).json() == {"text": ""} and not calls, "almost no voice: the model is never asked"
    assert client.post(f"/api/interviews/{sid}/transcribe?ms=5000&voiced=3000", content=audio, headers=h).json() == {"text": ""}, "a long fluent sentence at very low confidence is a guess"
    answer["logprobs"] = [type("L", (), {"logprob": -0.05})() for _ in range(12)]
    assert client.post(f"/api/interviews/{sid}/transcribe?ms=5000&voiced=3000", content=audio, headers=h).json()["text"].startswith("Sure, I have"), "confident speech passes"


def test_interview_credits_text_costs_one_voice_and_coding_cost_two(client, monkeypatch):
    script(monkeypatch, [{"say": "Q1?", "kind": "question"}] * 8)
    usage = lambda: client.get("/api/billing/subscription").json()["usage"]["interview"]
    assert usage()["limit"] == 2 and usage()["unit"] == "credits"
    assert start(client, mode="text").status_code == 200 and usage()["used"] == 1, "a text interview costs 1 credit"
    assert start(client, mode="text").status_code == 200 and usage()["used"] == 2
    r = start(client, mode="text")
    assert r.status_code == 402 and r.json()["detail"]["feature"] == "interview", "out of credits"
    upgrade(client, "pilot")
    before = usage()["used"]
    assert start(client, mode="voice").status_code == 200 and usage()["used"] == before + 2, "a voice interview costs 2 credits"
    assert start(client).status_code == 200 and usage()["used"] == before + 4, "voice is the default mode"
    assert start(client, mode="smoke-signals").status_code == 422, "an unknown mode is rejected"


def test_talking_interviews_are_time_boxed_not_counted_in_questions(client, monkeypatch):
    prompts = []

    async def fake(db, system, user, temperature=0.6, **kw):
        prompts.append(user)
        return next(replies)

    replies = iter([
        {"say": "Hi, tell me about yourself.", "kind": "question"},
        {"say": "Interesting. How did you test it?", "kind": "question", "score": 3, "note": "ok"},
        {"say": "One more thing: scaling?", "kind": "question", "score": 3, "note": "ok"},
    ])
    monkeypatch.setattr(iv, "json_chat", fake)
    sid = start(client, minutes=15).json()["id"]
    assert "15 minutes long" in prompts[0] and "no fixed number of questions" in prompts[0]
    r = client.post(f"/api/interviews/{sid}/answer", json={"text": "I built a thing"}).json()
    assert r["kind"] == "question" and r["done"] is False, "time remains: the interviewer keeps asking"
    assert "minutes used" in prompts[-1] and "Do not count questions" in prompts[-1]
    from app.db import SessionLocal
    from app.models import InterviewSession
    from datetime import datetime, timezone, timedelta
    with SessionLocal() as db:
        row = db.get(InterviewSession, sid)
        row.created_at = datetime.now(timezone.utc) - timedelta(minutes=16)
        db.commit()
    r = client.post(f"/api/interviews/{sid}/answer", json={"text": "We load tested it"}).json()
    assert r["kind"] == "wrapup" and "questions for me" in r["say"], "when the time box is full the interviewer invites your questions instead of asking another"
