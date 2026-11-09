#!/usr/bin/env bash
# Usage: loadtest/run-stage.sh <name> <CACHE_BACKEND> [REDIS_URL]
# Recreates the 1-vCPU load-test API (same image, isolated DB) with the given cache config, then runs k6 against it.
set -euo pipefail
name=$1; backend=$2; redis=${3:-}; dur=${DUR:-12s}
docker rm -f hp-load-api >/dev/null 2>&1 || true
docker run -d --name hp-load-api --network hirepilot_default --cpus=1 --memory=2g -p 8001:8000 \
  -e DATABASE_URL=postgresql+psycopg://hirepilot:hirepilot@db:5432/hirepilot_load -e SECRET_KEY=load-test \
  -e CACHE_BACKEND="$backend" -e REDIS_URL="$redis" hirepilot-backend >/dev/null
until curl -sf localhost:8001/api/health >/dev/null; do sleep 0.5; done
mkdir -p /tmp/hp-load
k6 run -q -e BASE=http://localhost:8001 -e VUS=${VUS:-64} -e DUR=$dur --summary-export=/tmp/hp-load/$name.json loadtest/read-path.js >/dev/null 2>&1 || true
python3 loadtest/summarize.py /tmp/hp-load/$name.json ${dur%s}
echo "cache stats: $(curl -s localhost:8001/api/jobs/cache/stats)"
