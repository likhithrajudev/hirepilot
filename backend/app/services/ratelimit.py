"""Sliding-window rate limits for credential endpoints. Uses Redis when configured (shared across API instances),
otherwise a per-process window."""
import time
from collections import defaultdict, deque

from . import cache

_local: dict[str, deque] = defaultdict(deque)


def hit(key: str, limit: int, window_s: int) -> tuple[bool, int]:
    """Record one attempt. Returns (allowed, retry_after_seconds)."""
    backend = cache._get()
    r = getattr(backend, "_r", None)  # the Redis client when the cache backend is redis
    if r is not None:
        try:
            n = r.incr(f"rl:{key}")
            if n == 1:
                r.expire(f"rl:{key}", window_s)
            if n > limit:
                return False, max(1, int(r.ttl(f"rl:{key}") or window_s))
            return True, 0
        except Exception:
            pass  # fall back to the local window rather than blocking sign-ins because Redis is down
    now = time.monotonic()
    q = _local[key]
    while q and now - q[0] > window_s:
        q.popleft()
    if len(q) >= limit:
        return False, max(1, int(window_s - (now - q[0])))
    q.append(now)
    return True, 0


def reset(key: str) -> None:
    _local.pop(key, None)
    r = getattr(cache._get(), "_r", None)
    if r is not None:
        try:
            r.delete(f"rl:{key}")
        except Exception:
            pass


def clear_all() -> None:  # tests
    _local.clear()
