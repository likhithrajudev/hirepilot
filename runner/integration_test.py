"""Real API → controller → sandbox checks, using an isolated temporary database.

Run inside the backend container; existing users, usage and sessions are untouched:
docker compose exec -T backend python - < runner/integration_test.py
"""
import os
from pathlib import Path
from uuid import uuid4

database = Path("/tmp") / ("hirepilot-coding-e2e-" + uuid4().hex + ".sqlite")
os.environ["DATABASE_URL"] = f"sqlite:///{database}"
os.environ["CACHE_BACKEND"] = "off"
os.environ["FAST_PASSWORD_HASH"] = "true"
os.environ["SECRET_KEY"] = "isolated-coding-integration-secret-at-least-32-bytes"

from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal, engine
from app.models import CodingWorkspace
from app.routers import interviews
from app.services.coding_problems import STARTERS

SOURCES = {
    "python": '''import sys
from collections import Counter
a=list(map(int,sys.stdin.read().split()));n,target=a[:2];seen=Counter();total=0
for x in a[2:2+n]:
    total+=seen[target-x];seen[x]+=1
print(total)
''',
    "javascript": '''const a=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);
const n=a[0], target=a[1], seen=new Map();let count=0;
for(let i=2;i<2+n;i++){const x=a[i];count+=seen.get(target-x)||0;seen.set(x,(seen.get(x)||0)+1);}
console.log(count);
''',
    "cpp": '''#include <bits/stdc++.h>
using namespace std;
int main(){int n;long long t,x,count=0;cin>>n>>t;unordered_map<long long,long long> seen;
for(int i=0;i<n;i++){cin>>x;count+=seen[t-x];seen[x]++;}cout<<count;}
''',
    "java": '''import java.util.*;
public class Main{public static void main(String[] args){Scanner sc=new Scanner(System.in);int n=sc.nextInt();long target=sc.nextLong(),count=0;
Map<Long,Long> seen=new HashMap<>();for(int i=0;i<n;i++){long x=sc.nextLong();count+=seen.getOrDefault(target-x,0L);seen.put(x,seen.getOrDefault(x,0L)+1);}
System.out.print(count);}}
''',
}


async def fake_model(db, system, prompt, temperature=.3):
    if system is interviews.REPORT:
        assert "SAVED CODING WORKSPACE" in prompt and "accepted" in prompt
        return {"overall": 80, "verdict": "good", "summary": "Integration fixture: saved code and executed tests were included.", "dimensions": {}, "strengths": [], "improvements": [], "questions": [], "practice_plan": []}
    return {"say": "I'm Karthik, your AI interviewer. Read the coding problem and describe your approach.", "kind": "question"}


interviews.json_chat = fake_model


def main():
    with TestClient(app) as client:
        account = client.post("/api/auth/signup", json={"email": f"qa-{uuid4().hex}@example.com", "password": "coding-integration-only-password", "name": "Isolated coding fixture"})
        assert account.status_code == 201
        client.headers["Authorization"] = "Bearer " + account.json()["access_token"]
        availability = client.get("/api/interviews/coding/status").json()
        assert availability["ready"], availability
        created = client.post("/api/interviews", json={"kind": "coding", "difficulty": "easy", "coding_problems": 2})
        assert created.status_code == 200, created.text
        sid = created.json()["id"]
        # Fix this isolated fixture's sequence so all languages face identical tests.
        with SessionLocal() as db:
            ws = db.get(CodingWorkspace, sid); ws.problems = ["pairs", "brackets"]
            ws.solutions = {pid: {"language": "python", "sources": {"python": STARTERS["python"]}} for pid in ws.problems}; db.commit()
        version = 0
        def save(language, source, pid="pairs"):
            nonlocal version
            response = client.put(f"/api/interviews/{sid}/coding", json={"version": version, "problem_id": pid, "language": language, "source": source})
            assert response.status_code == 200, response.text
            version = response.json()["version"]
        def run(mode="submit"):
            response = client.post(f"/api/interviews/{sid}/coding/run", json={"version": version, "mode": mode})
            assert response.status_code == 200, response.text
            return response.json()
        for language, source in SOURCES.items():
            save(language, source)
            if language == "python":
                examples = run("examples")
                assert examples["status"] == "accepted" and examples["result"]["total"] == 2
            result = run()
            assert result["status"] == "accepted", result
            assert result["result"]["passed"] == result["result"]["total"] == 7
            for case in result["result"]["cases"]:
                if case["hidden"]: assert not {"input", "expected", "output", "stderr"} & case.keys()
            print(f"{language}: API save + isolated full suite 7/7", flush=True)
        save("python", "print(0)")
        assert run()["status"] == "failed"
        save("cpp", "invalid C++ fixture")
        assert run()["status"] == "compile_error"
        save("python", SOURCES["python"])
        result = client.post(f"/api/interviews/{sid}/coding/next", json={"version": version})
        assert result.status_code == 200, result.text
        ws = result.json(); version = ws["version"]
        assert ws["active_index"] == 1
        save("python", '''import sys
stack=[];good=True
for c in sys.stdin.read().strip():
    if c in '([{': stack.append(c)
    elif not stack or stack.pop()!={')':'(',']':'[','}':'{'}[c]: good=False;break
print('YES' if good and not stack else 'NO')
''', "brackets")
        assert run()["status"] == "accepted"
        report = client.post(f"/api/interviews/{sid}/finish")
        assert report.status_code == 200 and report.json()["report"]["overall"] == 80, report.text
        saved = client.get(f"/api/interviews/{sid}/coding").json()
        assert len(saved["runs"]) == 8 and len(saved["solutions"]["pairs"]["sources"]) == 4
        assert client.put(f"/api/interviews/{sid}/coding", json={"version": version, "problem_id": "brackets", "language": "python", "source": "late edit"}).status_code == 409
        print("Wrong answers, compiler errors, sequential progression, report context and read-only artifacts: passed", flush=True)
        print("API/controller/runtime integration passed; existing database was not used", flush=True)


try:
    main()
finally:
    engine.dispose()
    database.unlink(missing_ok=True)
