# Read-path load test, piece 1

**Setup.** One API instance capped at 1 vCPU / 2 GB (the size of one Fargate task in the AWS design), Postgres 16 with
50,000 jobs in an isolated database, k6 with 64 virtual users per endpoint for 12 s, everything on one laptop
(10 vCPU Docker VM). Treat absolute numbers as relative: the laptop also runs the load generator and Docker's port
proxy. What matters is the ratio between stages and the per-vCPU capacity they imply.

| Endpoint | Baseline | + DB fixes | + in-process cache | + Redis (plain) | + Redis with local layer |
|---|---|---|---|---|---|
| `GET /api/jobs?sort=score&limit=200` | 108 req/s, p99 1222 ms | 212, 692 ms | 987, 125 ms | 459, 487 ms | **882, 337 ms** |
| `GET /api/jobs?location=Bengaluru&level=new_grad&limit=50` | 160, 855 ms | 320, 463 ms | 1266, 94 ms | 768, 160 ms | **1264, 101 ms** |
| `GET /api/jobs/companies` | 200, 695 ms | 310, 441 ms | 1134, 150 ms | 704, 155 ms | **1206, 102 ms** |
| `GET /api/health` (framework ceiling) | 3727 | 3501 | 3608 | 3486 | 3490 |

## What each stage was for
1. **DB fixes** (2x). Profiling showed 35 of 53 ms per list query was loading the unused `description` column, plus a
   73-78 ms sequential scan for sorting and `ILIKE`. Fixes: `defer(description)`, a partial index matching the sort, and a
   `pg_trgm` GIN index for city filters.
2. **Cache the finished JSON bytes** (about 9x vs baseline). A hit skips the database, ORM and serialisation.
   Stampede control worked: 40,560 hits, 3 builds for 3 distinct keys.
3. **Redis**. Needed once there is more than one API instance, because invalidation must reach all of them. Plain Redis
   was half as fast as in-process (two network round trips per hit), so a 250 ms local version cache and a local value
   copy sit in front of it. That recovered the speed and kept shared invalidation.

## Capacity implied
A cache hit costs about 0.8-1.1 ms of one vCPU for 16-66 KB bodies (about 3,500 req/s for tiny bodies).
At the design's 99% edge hit ratio, 1M req/s leaves about 10,000 req/s at the origin, which is roughly 10-12 vCPUs of
API tasks. That edge hit ratio is not available yet: these responses carry per-user state, so they are sent
`Cache-Control: private`. Splitting a shared public catalog from a per-user overlay is the CDN piece.

## Re-run
```bash
loadtest/run-stage.sh <name> off|memory|redis [redis-url]
```
