"""Trusted fixture tests for the runtime image, without starting a socket-mounted
controller. Run from the checkout with a local Docker CLI. No host mounts.
"""
import base64
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4


def run(language, source, inputs):
    payload = base64.b64encode(json.dumps({"language": language, "source": source, "inputs": inputs}).encode()).decode()
    name = "hirepilot-code-smoke-" + uuid4().hex
    command = ["docker", "run", "--rm", "--init", "--name", name, "--network", "none", "--read-only", "--user", "65534:65534",
               "--memory", "512m", "--memory-swap", "512m", "--cpus", "1", "--pids-limit", "64", "--cap-drop", "ALL",
               "--security-opt", "no-new-privileges:true", "--tmpfs", "/work:rw,exec,nosuid,nodev,size=134217728,mode=1777",
               "--ulimit", "nofile=64:64", "--ulimit", "fsize=8388608:8388608", "-e", "HOME=/work", "-e", "TMPDIR=/work",
               "hirepilot-code-runtime:local", "python3", "/opt/execute.py", payload]
    try:
        response = subprocess.run(command, capture_output=True, text=True, timeout=60, check=True)
        return json.loads(response.stdout)
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=10)


def main():
    fixtures = {
        "python": "import sys\nprint(sys.stdin.read().strip())",
        "javascript": 'process.stdout.write(require("fs").readFileSync(0, "utf8").trim());',
        "cpp": '#include <iostream>\n#include <string>\nint main(){std::string s;std::getline(std::cin,s);std::cout<<s;}',
        "java": 'public class Main { public static void main(String[] a) throws Exception { System.out.print(new String(System.in.readAllBytes()).trim()); } }',
    }
    for language, source in fixtures.items():
        result = run(language, source, ["hello\n", "edge case\n"])
        assert result["status"] == "finished", (language, result)
        assert [r["stdout"].strip() for r in result["cases"]] == ["hello", "edge case"], (language, result)
        assert all(r["status"] == "ok" for r in result["cases"]), (language, result)
        print(language + ": compile/run and per-case stdin passed", flush=True)
    result = run("cpp", "this is not valid C++", [""])
    assert result["status"] == "compile_error", result
    print("compiler error: passed", flush=True)
    result = run("python", "while True: pass", [""])
    assert result["cases"][0]["status"] == "time_limit", result
    print("timeout: passed", flush=True)
    result = run("python", "print('x' * 100000)", [""])
    assert result["cases"][0]["status"] == "output_limit", result
    print("output limit: passed", flush=True)
    result = run("python", "raise ValueError('fixture failure')", [""])
    assert result["cases"][0]["status"] == "runtime_error", result
    print("runtime error: passed", flush=True)
    source = '''import os, socket
assert os.getuid() == 65534
assert not os.path.exists('/var/run/docker.sock')
try:
    open('/etc/forbidden', 'w')
    raise AssertionError('writable root')
except OSError:
    pass
s = socket.socket(); s.settimeout(.5)
assert s.connect_ex(('1.1.1.1', 443)) != 0
print('isolated')
'''
    result = run("python", source, [""])
    assert result["cases"][0]["status"] == "ok" and result["cases"][0]["stdout"].strip() == "isolated", result
    print("non-root, no Docker socket, read-only root, no egress: passed", flush=True)
    print("All runtime smoke checks passed", flush=True)


if __name__ == "__main__":
    main()
