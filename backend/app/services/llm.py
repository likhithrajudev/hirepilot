import json
import time

from fastapi import HTTPException
from openai import APIError, APITimeoutError, AsyncOpenAI, AuthenticationError, RateLimitError
from sqlalchemy.orm import Session

from . import context, settings_store

# USD per 1M tokens (input, output). Update when the provider changes prices; history keeps the cost it was charged at.
PRICES = {"gpt-4o": (2.50, 10.00), "gpt-4o-mini": (0.15, 0.60), "gpt-4.1": (2.00, 8.00), "gpt-4.1-mini": (0.40, 1.60), "gpt-4.1-nano": (0.10, 0.40)}


_clients: dict = {}


def openai_client(key: str, timeout: float = 100):
    """One long-lived client per key, so every call reuses an open, already-secured connection instead of paying a fresh TLS handshake
    (roughly a quarter of a second) each time. The class is looked up at call time so tests can substitute it."""
    import openai

    cls = openai.AsyncOpenAI
    k = (id(cls), key, timeout)
    c = _clients.get(k)
    if c is None:
        if len(_clients) > 16:
            _clients.clear()
        c = _clients[k] = cls(api_key=key, timeout=timeout, max_retries=1)
    return c


def cost_usd(model: str, tin: int, tout: int) -> float:
    base = next((k for k in sorted(PRICES, key=len, reverse=True) if model.startswith(k)), None)
    pin, pout = PRICES.get(base, (2.50, 10.00))
    return round((tin * pin + tout * pout) / 1_000_000, 6)


def _record(model: str, tin: int, tout: int, started: float, ok: bool, error: str = "") -> None:
    """Best effort: a failure to write the ledger must never break the user's request."""
    try:
        from ..db import SessionLocal
        from ..models import UsageEvent, User

        uid = context.current_user_id.get()
        with SessionLocal() as s:
            u = s.get(User, uid) if uid else None
            s.add(UsageEvent(user_id=uid, tenant_id=u.tenant_id if u else None, purpose=context.current_purpose.get(), model=model,
                             input_tokens=tin, output_tokens=tout, cost_usd=cost_usd(model, tin, tout), duration_ms=int((time.monotonic() - started) * 1000), ok=ok, error=error[:200] or None))
            s.commit()
    except Exception:
        pass


async def _complete(db: Session, system: str, user: str, temperature: float, json_mode: bool) -> str:
    key, _ = settings_store.get_openai_key(db)
    if not key:
        raise HTTPException(400, "No OpenAI API key configured. Add one in Settings.")
    # One retry and a 100 s ceiling per attempt: a stuck request must fail in ~3 minutes, not 6.
    client = openai_client(key, 100)
    kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
    model = settings_store.get_model(db)
    started = time.monotonic()
    try:
        resp = await client.chat.completions.create(
            model=model, temperature=temperature, **kwargs,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
    except AuthenticationError:
        _record(model, 0, 0, started, False, "auth")
        raise HTTPException(400, "OpenAI rejected the API key. Check it in Settings.")
    except RateLimitError:
        _record(model, 0, 0, started, False, "rate_limit")
        raise HTTPException(429, "OpenAI rate limit or quota exceeded.")
    except APITimeoutError:
        _record(model, 0, 0, started, False, "timeout")
        raise HTTPException(504, "OpenAI took too long to respond. Try again in a moment.")
    except APIError as e:
        _record(model, 0, 0, started, False, "provider_error")
        raise HTTPException(502, f"OpenAI error: {e.message}")
    u = getattr(resp, "usage", None)
    _record(model, getattr(u, "prompt_tokens", 0) or 0, getattr(u, "completion_tokens", 0) or 0, started, True)
    return resp.choices[0].message.content or ""


async def json_chat(db: Session, system: str, user: str, temperature: float = 0.3) -> dict:
    """For answers that contain no LaTeX. (LaTeX inside JSON strings gets corrupted: see text_chat.)"""
    text = await _complete(db, system, user, temperature, json_mode=True)
    try:
        return json.loads(text or "{}")
    except json.JSONDecodeError:
        raise HTTPException(502, "The model returned invalid JSON. Try again.")


async def text_chat(db: Session, system: str, user: str, temperature: float = 0.3) -> str:
    """Plain-text completion. Use this whenever the answer contains LaTeX: in a JSON string, `\\begin` would decode
    as backspace+"egin", `\\newcommand` as newline+"ewcommand", `\\textbf` as tab+"extbf" and `\\footnotesize` as a
    form feed, silently destroying the document."""
    return await _complete(db, system, user, temperature, json_mode=False)


async def stream_chat(db: Session, system: str, user: str, temperature: float = 0.6):
    """Plain-text completion as an async generator of text deltas, so a spoken reply can start before the model has finished.
    Raises the same HTTPExceptions as the other helpers (before or between chunks) and records usage when the stream ends."""
    key, _ = settings_store.get_openai_key(db)
    if not key:
        raise HTTPException(400, "No OpenAI API key configured. Add one in Settings.")
    client = openai_client(key, 100)
    model = settings_store.get_model(db)
    started = time.monotonic()
    tin = tout = 0
    try:
        stream = await client.chat.completions.create(
            model=model, temperature=temperature, stream=True, stream_options={"include_usage": True},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        async for chunk in stream:
            u = getattr(chunk, "usage", None)
            if u:
                tin, tout = getattr(u, "prompt_tokens", 0) or 0, getattr(u, "completion_tokens", 0) or 0
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    except AuthenticationError:
        _record(model, 0, 0, started, False, "auth")
        raise HTTPException(400, "OpenAI rejected the API key. Check it in Settings.")
    except RateLimitError:
        _record(model, 0, 0, started, False, "rate_limit")
        raise HTTPException(429, "OpenAI rate limit or quota exceeded.")
    except APITimeoutError:
        _record(model, 0, 0, started, False, "timeout")
        raise HTTPException(504, "OpenAI took too long to respond. Try again in a moment.")
    except APIError as e:
        _record(model, 0, 0, started, False, "provider_error")
        raise HTTPException(502, f"OpenAI error: {e.message}")
    _record(model, tin, tout, started, True)
