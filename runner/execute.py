"""Runs ONLY inside a disposable restricted container, never in the API service."""
import base64
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

OUTPUT = 32768


def command(args, stdin="", timeout=2):
    start = time.monotonic()
    with open("/work/out", "wb+") as out, open("/work/err", "wb+") as err:
        process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=out, stderr=err, cwd="/work", start_new_session=True)
        status = "ok"
        try:
            process.communicate(stdin.encode(), timeout=timeout)
        except subprocess.TimeoutExpired:
            status = "time_limit"
        finally:
            # Kill descendants as well, even when the direct child exited normally.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        if status == "ok" and process.returncode != 0:
            status = "runtime_error"
        if out.tell() > OUTPUT or err.tell() > OUTPUT:
            status = "output_limit"
        out.seek(0); err.seek(0)
        return {"status": status, "stdout": out.read(OUTPUT).decode("utf-8", "replace"),
                "stderr": err.read(OUTPUT).decode("utf-8", "replace"), "duration_ms": round((time.monotonic() - start) * 1000)}


def main():
    payload = json.loads(base64.b64decode("".join(sys.argv[1:])))
    language, source = payload["language"], payload["source"]
    filename, build, run = {
        "python": ("main.py", None, ["python3", "-I", "/work/main.py"]),
        "javascript": ("main.js", None, ["node", "--max-old-space-size=128", "/work/main.js"]),
        "cpp": ("main.cpp", ["g++", "-std=c++17", "-O2", "/work/main.cpp", "-o", "/work/main"], ["/work/main"]),
        "java": ("Main.java", ["javac", "-J-Xmx128m", "-J-XX:ActiveProcessorCount=1", "/work/Main.java"],
                 ["java", "-Xmx128m", "-XX:+UseSerialGC", "-XX:ActiveProcessorCount=1", "-XX:CompressedClassSpaceSize=32m", "-XX:MaxMetaspaceSize=64m", "-cp", "/work", "Main"]),
    }[language]
    Path(filename).write_text(source)
    if build:
        compiled = command(build, timeout=20)
        if compiled["status"] != "ok":
            return {"status": "compile_error", "message": compiled["stderr"] or compiled["status"], "cases": []}
    return {"status": "finished", "cases": [command(run, item, timeout=2) for item in payload["inputs"]]}


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception:
        print(json.dumps({"status": "runtime_error", "message": "Execution could not complete", "cases": []}))
