"""Read-through cache for hot, expensive-to-compute responses.

Design choices (each is there because of a measurement or a failure mode, not by default):
- Stores the finished JSON bytes, so a hit skips the database, the ORM and serialisation entirely.
- Invalidation is a per-namespace version number baked into every key: bumping it makes all old keys unreachable in
  O(1), with no key scanning. With Redis the version is shared, so every API instance sees the invalidation.
- Single-flight per key: when a hot key expires, one request rebuilds it and the rest wait, instead of N requests
  hitting the database at once (cache stampede).
- Fails open: if Redis is slow or down we fall back to building from the database and skip Redis for a few seconds.
"""
import hashlib
import json
import logging
import threading
import time
from typing import Callable, Optional

from ..config import settings

log = logging.getLogger("hirepilot.cache")
_STRIPES = [threading.Lock() for _ in range(64)]
stats = {"hits": 0, "misses": 0, "builds": 0, "errors": 0, "waited": 0}


class _Memory:
    def __init__(self, max_items: int = 4096) -> None:
        self._d: dict[str, tuple[float, bytes]] = {}
        self._ver: dict[str, int] = {}
        self._max = max_items
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[bytes]:
        v = self._d.get(key)
        if v is None:
            return None
        if v[0] <= time.monotonic():
            self._d.pop(key, None)
            return None
        return v[1]

    def set(self, key: str, val: bytes, ttl: int) -> None:
        with self._lock:
            if len(self._d) >= self._max:  # bounded: drop the oldest tenth
                for k in list(self._d)[: self._max // 10]:
                    self._d.pop(k, None)
            self._d[key] = (time.monotonic() + ttl, val)

    def version(self, ns: str) -> int:
        return self._ver.get(ns, 0)

    def bump(self, ns: str) -> None:
        with self._lock:
            self._ver[ns] = self._ver.get(ns, 0) + 1


class _Redis:
    """Redis is the shared source of truth (so every API instance sees the same data and the same invalidations).
    A tiny local layer in front removes the two network round trips per hit that made Redis ~2x slower than memory:
    - the namespace version is re-read at most every VERSION_TTL seconds, bounding cross-instance staleness;
    - values are keyed by version, so a local copy can never outlive an invalidation beyond that window.
    """

    VERSION_TTL = 0.25

    def __init__(self, url: str) -> None:
        import redis

        self._r = redis.Redis.from_url(url, socket_timeout=0.25, socket_connect_timeout=0.25, max_connections=128)
        self._down_until = 0.0
        self._l1 = _Memory()
        self._ver: dict[str, tuple[float, int]] = {}

    def _call(self, fn, default=None):
        if time.monotonic() < self._down_until:
            return default
        try:
            return fn()
        except Exception as e:  # timeouts, connection refused...
            stats["errors"] += 1
            self._down_until = time.monotonic() + 5  # circuit breaker: do not add latency to every request
            log.warning("redis unavailable, falling back to the database for 5s: %s", e)
            return default

    def get(self, key: str) -> Optional[bytes]:
        v = self._l1.get(key)
        if v is not None:
            return v
        v = self._call(lambda: self._r.get(key))
        if v is not None:
            self._l1.set(key, v, settings.cache_ttl_seconds)
        return v

    def set(self, key: str, val: bytes, ttl: int) -> None:
        self._l1.set(key, val, ttl)
        self._call(lambda: self._r.set(key, val, ex=ttl))

    def version(self, ns: str) -> int:
        now = time.monotonic()
        cached = self._ver.get(ns)
        if cached and cached[0] > now:
            return cached[1]
        v = self._call(lambda: self._r.get(f"ver:{ns}"))
        ver = int(v) if v else 0
        self._ver[ns] = (now + self.VERSION_TTL, ver)
        return ver

    def bump(self, ns: str) -> None:
        n = self._call(lambda: self._r.incr(f"ver:{ns}"))
        # The instance that wrote sees its own write immediately; others catch up within VERSION_TTL.
        self._ver[ns] = (time.monotonic() + self.VERSION_TTL, int(n) if n else self._ver.get(ns, (0, 0))[1] + 1)


_backend = None
_backend_key = None


def _get():
    global _backend, _backend_key
    key = (settings.cache_backend, settings.redis_url)
    if key != _backend_key:
        _backend_key = key
        if settings.cache_backend == "redis" and settings.redis_url:
            _backend = _Redis(settings.redis_url)
        elif settings.cache_backend in ("memory", "redis"):
            _backend = _Memory()
        else:
            _backend = None
    return _backend


def version(ns: str) -> int:
    b = _get()
    return b.version(ns) if b else 0


def bump(ns: str) -> None:
    b = _get()
    if b:
        b.bump(ns)


def cached_json(ns: str, params: dict, ttl: int, build: Callable[[], bytes]) -> tuple[bytes, str, str]:
    """Return (body, etag, 'HIT'|'MISS'|'BYPASS'). `build` must produce the exact response bytes."""
    b = _get()
    if b is None:
        body = build()
        return body, _etag(body), "BYPASS"
    digest = hashlib.sha1(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:20]
    key = f"{ns}:{b.version(ns)}:{digest}"
    body = b.get(key)
    if body is not None:
        stats["hits"] += 1
        return body, _etag(body), "HIT"
    # Single-flight: everyone who misses queues on the key's stripe lock. The first builds and stores; the rest wake
    # up, find the value on the re-check and return it, so a hot key expiring costs one database query, not N.
    with _STRIPES[int(digest, 16) % len(_STRIPES)]:
        body = b.get(key)
        if body is not None:
            stats["waited"] += 1
            return body, _etag(body), "HIT"
        stats["misses"] += 1
        body = build()
        stats["builds"] += 1
        b.set(key, body, ttl)
        return body, _etag(body), "MISS"


def _etag(body: bytes) -> str:
    return '"' + hashlib.blake2b(body, digest_size=12).hexdigest() + '"'
