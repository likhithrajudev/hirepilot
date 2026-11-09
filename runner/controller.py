"""Trusted, internal-only Docker controller. Never evaluates candidate source.

The Docker socket is available to this service ONLY. Every container option is
fixed here; callers cannot choose images, mounts, commands, networking or limits.
"""
import asyncio
import base64
import hmac
import json
import logging
import os

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from typing import Literal

app = FastAPI(docs_url=None, redoc_url=None)
slots = asyncio.Semaphore(2)
IMAGE = "hirepilot-code-runtime:local"
ENGINE = "http://docker/v1.45"


class Job(BaseModel):
    language: Literal["python", "javascript", "cpp", "java"]
    source: str = Field(min_length=1, max_length=50000)
    inputs: list[str] = Field(min_length=1, max_length=12)


def authorize(value):
    token = os.environ.get("RUNNER_TOKEN", "")
    if not token or not hmac.compare_digest(value or "", token):
        raise HTTPException(403, "Runner authorization required")


@app.get("/health")
async def health(x_runner_token: str | None = Header(None)):
    authorize(x_runner_token)
    async with httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(uds="/var/run/docker.sock"), timeout=5) as client:
        response = await client.get(f"{ENGINE}/images/{IMAGE}/json")
        return {"ready": response.status_code == 200}


@app.post("/execute")
async def execute(job: Job, x_runner_token: str | None = Header(None)):
    authorize(x_runner_token)
    if sum(len(x.encode()) for x in job.inputs) > 500000 or len(job.source.encode()) > 50000:
        raise HTTPException(422, "Job too large")
    if slots.locked():
        raise HTTPException(429, "Execution capacity is busy. Try again shortly.")
    async with slots:
        payload = base64.b64encode(json.dumps(job.model_dump(), ensure_ascii=False).encode()).decode()
        if len(payload) > 1500000:
            raise HTTPException(422, "Job too large")
        spec = {"Image": IMAGE, "Cmd": ["python3", "/opt/execute.py", *[payload[i:i + 60000] for i in range(0, len(payload), 60000)]], "User": "65534:65534",
                "WorkingDir": "/work", "NetworkDisabled": True, "Env": ["HOME=/work", "TMPDIR=/work", "LANG=C.UTF-8", "PYTHONDONTWRITEBYTECODE=1"],
                "Labels": {"hirepilot.code-sandbox": "true"}, "HostConfig": {
                    "NetworkMode": "none", "ReadonlyRootfs": True, "CapDrop": ["ALL"],
                    "SecurityOpt": ["no-new-privileges:true"], "Memory": 536870912, "MemorySwap": 536870912,
                    "NanoCpus": 1000000000, "PidsLimit": 64, "Init": True,
                    "Tmpfs": {"/work": "rw,exec,nosuid,nodev,size=134217728,mode=1777"},
                    "Ulimits": [{"Name": "nofile", "Soft": 64, "Hard": 64}, {"Name": "fsize", "Soft": 8388608, "Hard": 8388608}],
                    "LogConfig": {"Type": "json-file", "Config": {"max-size": "1m", "max-file": "1"}}}}
        cid = None
        async with httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(uds="/var/run/docker.sock"), timeout=70) as client:
            try:
                created = await client.post(f"{ENGINE}/containers/create", json=spec)
                created.raise_for_status()
                cid = created.json()["Id"]
                (await client.post(f"{ENGINE}/containers/{cid}/start")).raise_for_status()
                async with asyncio.timeout(60):
                    waited = await client.post(f"{ENGINE}/containers/{cid}/wait", params={"condition": "not-running"})
                    waited.raise_for_status()
                    if waited.json().get("StatusCode") != 0:
                        return {"status": "runtime_error", "message": "Sandbox exited or exceeded its resource limit", "cases": []}
                    # Docker multiplexes stdout/stderr into frames, each with an 8-byte header.
                    body = bytearray()
                    async with client.stream("GET", f"{ENGINE}/containers/{cid}/logs", params={"stdout": "true", "stderr": "false"}) as logs:
                        logs.raise_for_status()
                        async for chunk in logs.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > 1048576:
                                return {"status": "output_limit", "message": "Sandbox output exceeded limit", "cases": []}
                    output = bytearray()
                    while len(body) >= 8:
                        size = int.from_bytes(body[4:8], "big")
                        if size > len(body) - 8:
                            raise ValueError("Truncated output")
                        output.extend(body[8:8 + size]); del body[:8 + size]
                    result = json.loads(output)
                    if not isinstance(result, dict):
                        raise ValueError("Invalid output")
                    return result
            except TimeoutError:
                return {"status": "time_limit", "message": "Execution exceeded its total time limit", "cases": []}
            except (httpx.HTTPError, ValueError, KeyError):
                raise HTTPException(503, "Code runner is unavailable or returned invalid output")
            finally:
                if cid:
                    # Cancellation also removes the disposable sandbox.
                    try:
                        await asyncio.shield(client.delete(f"{ENGINE}/containers/{cid}", params={"force": "true", "v": "true"}, timeout=5))
                    except httpx.HTTPError:
                        logging.getLogger("hirepilot.runner").exception("Could not remove sandbox %s", cid)
