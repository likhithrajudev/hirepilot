import asyncio

from app.routers import interviews
from test_interviews import script, start


def test_completion_check_has_a_server_deadline(client, monkeypatch):
    script(monkeypatch, [{"say": "Tell me about an example.", "kind": "question"}])
    sid = start(client).json()["id"]
    monkeypatch.setattr(interviews, "TURN_CHECK_TIMEOUT_S", .01)
    async def stalled(*args, **kwargs):
        await asyncio.sleep(5)
        return {"complete": False}
    monkeypatch.setattr(interviews, "json_chat", stalled)
    response = client.post(f"/api/interviews/{sid}/turn-check", json={"text": "I explained my choice and the outcome."})
    assert response.status_code == 200
    assert response.json() == {"complete": False, "available": False}


def test_voice_style_prioritizes_clear_delivery_for_every_interviewer():
    for name, _, _ in interviews.PERSONAS:
        style = interviews.tts_style(name)
        assert "clear full voice" in style and "clean consonants" in style
        assert "vocal fry" in style
