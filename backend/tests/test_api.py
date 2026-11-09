import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import jobs as jobs_service
from app.services import tailor as tailor_service

LATEX = r"\documentclass{article}\begin{document}Hello \textbf{World}\end{document}"


@pytest.mark.parametrize(
    "title,expected",
    [
        ("Software Engineer, New Grad", "new_grad"),
        ("Software Engineering Intern (Summer 2027)", "intern"),
        ("Junior Backend Engineer", "junior"),
        ("Associate Software Engineer", "junior"),
        ("Software Engineer I", "junior"),
        ("Senior Software Engineer", "other"),
        ("Staff Backend Engineer, New Grad Mentor", "other"),
        ("Software Engineer III", "other"),
        ("Software Engineer, Payments", "other"),
    ],
)
def test_classify_titles(title, expected):
    assert jobs_service.classify(title, "") == expected


@pytest.mark.parametrize(
    "title,is_non_eng",
    [("Associate Sales Engineer, SE Desk", True), ("Technical Support Engineer", True),
     ("Software Engineer, New Grad", False), ("Backend Engineer I", False)],
)
def test_non_engineering_filter(title, is_non_eng):
    assert bool(jobs_service.NON_ENG_RE.search(title)) is is_non_eng


def test_classify_from_description():
    assert jobs_service.classify("Software Engineer", "We want 0-2 years of experience") == "junior"
    assert jobs_service.classify("Software Engineer", "Requires 5+ years of experience") == "other"
    # mid-level phrasing must not be treated as early-career
    assert jobs_service.classify("Software Engineer", "You have 1-3 years of experience") == "other"
    assert jobs_service.classify("Software Engineer", "1+ years of backend engineering experience") == "other"


def test_resume_crud_and_export(client):
    r = client.post("/api/resumes", json={"name": "Base", "latex": LATEX})
    assert r.status_code == 201
    rid = r.json()["id"]

    assert client.put(f"/api/resumes/{rid}", json={"name": "Renamed"}).json()["name"] == "Renamed"
    assert any(x["id"] == rid for x in client.get("/api/resumes").json())

    tex = client.get(f"/api/resumes/{rid}/export?format=tex")
    assert tex.status_code == 200 and LATEX in tex.text

    v = client.post(f"/api/resumes/{rid}/versions", json={"latex": LATEX, "company": "Acme", "job_title": "SWE"})
    assert v.status_code == 201 and v.json()["label"] == "Acme – SWE"
    assert len(client.get(f"/api/resumes/{rid}/versions").json()) == 1

    assert client.delete(f"/api/resumes/{rid}").status_code == 204
    assert client.get(f"/api/resumes/{rid}").status_code == 404


def test_tailor_needs_api_key(client):
    rid = client.post("/api/resumes", json={"name": "x", "latex": LATEX}).json()["id"]
    r = client.post(f"/api/resumes/{rid}/tailor", json={"job_description": "Python"})
    assert r.status_code == 400 and "API key" in r.json()["detail"]


def test_tailor_with_mocked_llm(client, monkeypatch):
    async def fake(db, system, user, temperature=0.3):
        return _reply(LATEX.replace("World", "Python"), changes=["Reworded"], matched_keywords=["python"], missing_keywords=["go"], estimated_fit=77)

    monkeypatch.setattr(tailor_service, "text_chat", fake)
    rid = client.post("/api/resumes", json={"name": "x", "latex": LATEX}).json()["id"]
    r = client.post(f"/api/resumes/{rid}/tailor", json={"job_description": "Python", "company": "Acme"})
    assert r.status_code == 200
    body = r.json()
    assert "Python" in body["latex"] and body["estimated_fit"] == 77 and body["company"] == "Acme"


def test_settings_roundtrip_hides_key(client):
    r = client.put("/api/settings", json={"openai_api_key": "sk-test-abcd1234", "openai_model": "gpt-4o-mini"})
    body = r.json()
    assert body["openai_configured"] and body["openai_key_hint"].endswith("1234")
    assert "sk-test" not in r.text
    client.put("/api/settings", json={"clear_openai_key": True})


def test_unbalanced_brace_hint():
    from app.services.latex import find_unbalanced_brace

    bad = "\\newenvironment{x}[2][]{\n{\\onecolentry\n  \\def\\a{#2}\n}{\n  \\endonecolentry\n}\n"
    assert "unclosed '{' on line 1" in find_unbalanced_brace(bad)
    assert "stray closing" in find_unbalanced_brace("a } b")
    assert find_unbalanced_brace("\\{ ok \\} % { in a comment\n\\textbf{fine}") is None


def test_geo_aliases_and_new_adapters_registered():
    from app.services import geo, jobs as j

    assert geo.location_matches("Bangalore, Karnataka, India", ["Bengaluru"])
    assert geo.location_matches("IN, KA, Bengaluru", ["bangalore"])
    assert geo.location_matches("Remote - US", ["Remote"]) and not geo.location_matches("London, UK", ["Bengaluru"])
    assert j.classify("Software Development Engineer - I", "") == "junior" and j.classify("SDE II, AWS", "") == "other"
    cos = j.load_companies()
    assert len(cos) >= 150 and all(c.get("domain") for c in cos)
    assert {"amazon", "microsoft", "workday", "smartrecruiters"} <= {c["ats"] for c in cos}


def test_ats_term_matching_and_parse_checks():
    from app.services import ats

    text = "Built REST APIs with Postgres and Spring Boot on AWS. Kubernetes (K8s) deployments."
    assert ats.term_present("PostgreSQL", text) and ats.term_present("Amazon Web Services", text)
    assert ats.term_present("Kubernetes", text) and not ats.term_present("Kafka", text)
    score, checks = ats.parse_checks("\\usepackage{paracol}", "x", 3)
    assert score < 60 and any(c["level"] == "bad" for c in checks)


def test_profile_roundtrip(client):
    r = client.put("/api/profile", json={"full_name": "Ada", "email": "ada@example.com", "city": "Bengaluru"})
    assert r.status_code == 200
    assert client.get("/api/profile").json()["email"] == "ada@example.com"


def test_ats_endpoint_with_mocked_llm(client, monkeypatch):
    from app.services import ats

    async def fake(db, system, user, temperature=0.3):
        return {
            "must_have": [{"term": "Python", "found": True}, {"term": "Kafka", "found": True}],
            "nice_to_have": [{"term": "Docker", "found": False}],
            "knockouts": [], "experience_fit": {"score": 70, "note": "ok"}, "impact": {"score": 60, "note": "ok"},
            "education": {"score": 80, "note": "ok"}, "recruiter_skim": "fine", "top_fixes": ["a"], "bullet_feedback": [],
        }

    monkeypatch.setattr(ats, "json_chat", fake)
    rid = client.post("/api/resumes", json={"name": "x", "latex": LATEX.replace("World", "Python developer")}).json()["id"]
    r = client.post(f"/api/resumes/{rid}/ats", json={"job_description": "We need Python and Kafka and Docker experience."})
    assert r.status_code == 200
    body = r.json()
    kafka = next(i for i in body["must_have"] if i["term"] == "Kafka")
    assert kafka["found"] is False  # the model claimed it, the resume text does not contain it
    assert {d["key"] for d in body["dimensions"]} == {"keywords", "experience", "impact", "education", "parse"}


# ---------- read cache ----------
@pytest.fixture()
def fresh_cache(monkeypatch):
    from app.config import settings
    from app.services import cache

    def use(backend="memory", redis_url=""):
        monkeypatch.setattr(settings, "cache_backend", backend)
        monkeypatch.setattr(settings, "redis_url", redis_url)
        cache._backend, cache._backend_key = None, None
        cache.stats.update(hits=0, misses=0, builds=0, errors=0, waited=0)
        return cache

    return use


def _add_job(owner=None, **kw):
    """Add a catalog job. `owner` (a user id) plus score/status also creates that user's private overlay row."""
    import uuid

    from app.db import SessionLocal
    from app.models import Job, UserJob

    state = {k: kw.pop(k) for k in ("score", "status") if k in kw}
    with SessionLocal() as db:
        kw.pop("eid", None)  # callers pass a label; the real id is unique per run because the test DB file persists
        j = Job(source="t", external_id=uuid.uuid4().hex, company="Acme", title=kw.pop("title", "SWE New Grad"),
                location="Bengaluru, IN", url="https://x", level_tag="new_grad", **kw)
        db.add(j)
        db.commit()
        if owner is not None and state:
            db.add(UserJob(user_id=owner, job_id=j.id, status=state.get("status", "new"), score=state.get("score")))
            db.commit()
        return j.id


def test_job_list_is_cached_etagged_and_invalidated(client, fresh_cache):
    fresh_cache("memory")
    import uuid

    tag = "CT" + uuid.uuid4().hex[:10]
    jid = _add_job(eid="cache-1", title=tag)
    a = client.get(f"/api/jobs?q={tag}")
    assert a.status_code == 200 and a.headers["x-cache"] == "MISS" and a.json()[0]["status"] == "new"
    b = client.get(f"/api/jobs?q={tag}")
    assert b.headers["x-cache"] == "HIT" and b.content == a.content
    # conditional request: unchanged data costs a 304 with no body
    c = client.get(f"/api/jobs?q={tag}", headers={"If-None-Match": a.headers["etag"]})
    assert c.status_code == 304 and c.content == b""
    # a write must invalidate immediately, not after the TTL
    assert client.patch(f"/api/jobs/{jid}", json={"status": "applied"}).status_code == 200
    d = client.get(f"/api/jobs?q={tag}")
    assert d.headers["x-cache"] == "MISS" and d.json()[0]["status"] == "applied"
    assert "description" not in d.json()[0]  # the list never ships the heavy column


def test_cache_off_bypasses(client, fresh_cache):
    fresh_cache("off")
    r = client.get("/api/jobs/companies")
    assert r.status_code == 200 and r.headers["x-cache"] == "BYPASS" and r.json()["total"] >= 150


def test_cache_fails_open_when_redis_is_down(client, fresh_cache):
    fresh_cache("redis", "redis://127.0.0.1:1/0")  # nothing listens on port 1
    import uuid

    tag = "RD" + uuid.uuid4().hex[:10]
    jid = _add_job(eid="cache-2", title=tag)
    r = client.get(f"/api/jobs?q={tag}")
    assert r.status_code == 200 and r.json()[0]["id"] == jid  # served from the database, no error
    assert client.get(f"/api/jobs?q={tag}").status_code == 200


def test_single_flight_one_build_per_cold_key(fresh_cache):
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor

    cache = fresh_cache("memory")
    builds = []

    def build():
        builds.append(1)
        time.sleep(0.15)
        return b"[]"

    with ThreadPoolExecutor(20) as pool:
        results = list(pool.map(lambda _: cache.cached_json("t", {"k": 1}, 30, build), range(20)))
    assert len(builds) == 1, "a cold hot-key must be built once, not once per waiting request"
    assert all(r[0] == b"[]" for r in results)


# ---------- tailoring guard + async tasks ----------
RESUME = r"""\documentclass[11pt]{article}
\usepackage[margin=1cm]{geometry}
\newenvironment{entry}[1]{\par\textbf{#1}\begin{itemize}}{\end{itemize}}
\begin{document}
\section{Experience}
\begin{entry}{Backend Engineer, Acme Corp (Jan 2024 - Present)}
\item Built REST APIs in Java and Spring Boot serving 2M requests per day.
\item Reduced p99 latency by 30\% using Redis caching.
\end{entry}
\section{Skills}
Java, Spring Boot, PostgreSQL, Redis, contact: ada@example.com
\end{document}
"""


def _reply(body_or_doc: str, **meta) -> str:
    """The wire format the tailor prompt asks for: JSON metadata, then the raw LaTeX body (no JSON string escaping)."""
    import json

    return f"===META===\n{json.dumps(meta)}\n===BODY===\n{body_or_doc}"


def _fake_pipeline(monkeypatch, replies, compile_ok=True):
    """Patch the model, the compiler and the PDF reader so the pipeline runs without OpenAI or TeX."""
    from app.services import ats, latex as latex_service, tailor as tailor_module

    calls = []
    queue = list(replies)

    async def fake_text(db, system, user, temperature=0.3):
        calls.append(user)
        return queue.pop(0) if len(queue) > 1 else queue[0]

    async def fake_compile(src):
        return latex_service.CompileResult(ok=compile_ok, pdf=b"%PDF-fake" if compile_ok else None, errors=[] if compile_ok else ["Undefined control sequence"], available=True)

    monkeypatch.setattr(tailor_module, "text_chat", fake_text)
    monkeypatch.setattr(latex_service, "compile_latex", fake_compile)
    monkeypatch.setattr(ats, "extract_pdf_text", lambda pdf: ("text", 1))
    return calls


def _run_tailor(**kw):
    import asyncio

    from app.services.tailor import tailor_resume

    return asyncio.run(tailor_resume(None, RESUME, "Needs Java and Spring Boot and Redis", **kw))


def test_tailor_never_lets_the_model_change_the_preamble(monkeypatch):
    from app.services import texguard

    evil = RESUME.replace("margin=1cm", "margin=5cm").replace(r"\newenvironment{entry}[1]{", r"\newenvironment{entry}[1]{{")
    body = texguard.split_document(RESUME)[1]
    _fake_pipeline(monkeypatch, [_reply(evil, changes=["x"], estimated_fit=70)])
    r = _run_tailor()
    assert texguard.split_document(r.latex)[0] == texguard.split_document(RESUME)[0]  # preamble is byte-identical
    assert r.compile_ok is True and r.warnings == []
    assert texguard.split_document(r.latex)[1].strip() == body.strip()


def test_tailor_repairs_invented_numbers_then_succeeds(monkeypatch):
    bad = RESUME.split(r"\begin{document}")[1].split(r"\end{document}")[0].replace("2M requests", "2M requests and cut cost by 45%")
    good = bad.replace(" and cut cost by 45%", "")
    calls = _fake_pipeline(monkeypatch, [_reply(bad, changes=["a"]), _reply(good, changes=["b"], estimated_fit=80)])
    r = _run_tailor()
    assert len(calls) == 2 and r.attempts == 2 and r.warnings == []
    assert "45" in calls[1], "the repair prompt must tell the model which number was invented"
    assert r.estimated_fit == 80 and "45" not in r.latex


def test_tailor_keeps_original_when_it_cannot_make_valid_latex(monkeypatch):
    _fake_pipeline(monkeypatch, [_reply(r"\section{Broken} {unclosed")], compile_ok=False)
    # base compile also "fails" here, so make only the candidate fail:
    from app.services import latex as latex_service

    state = {"n": 0}

    async def compile_second_fails(src):
        state["n"] += 1
        ok = state["n"] == 1
        return latex_service.CompileResult(ok=ok, pdf=b"%PDF-fake" if ok else None, errors=[] if ok else ["Runaway argument"], available=True)

    monkeypatch.setattr(latex_service, "compile_latex", compile_second_fails)
    r = _run_tailor()
    assert r.latex == RESUME and r.changes == []
    assert any("original was kept" in w for w in r.warnings)


def test_tailor_refuses_when_the_original_does_not_compile(monkeypatch):
    import asyncio

    import pytest as _pytest
    from fastapi import HTTPException

    from app.services.tailor import tailor_resume

    _fake_pipeline(monkeypatch, [_reply("x")], compile_ok=False)
    with _pytest.raises(HTTPException) as e:
        asyncio.run(tailor_resume(None, RESUME, "jd"))
    assert e.value.status_code == 422 and "does not compile" in str(e.value.detail)


def test_async_task_survives_and_returns_result(client, monkeypatch):
    import time

    from app.schemas import TailorResult
    from app.services import tasks as task_service

    async def fake_tailor(db, latex, jd, company, title, extra, opts, on_progress):
        on_progress("Tailoring your resume")
        import asyncio

        await asyncio.sleep(0.2)
        return TailorResult(latex=latex, changes=["did a thing"], estimated_fit=71, company=company)

    monkeypatch.setattr(task_service, "tailor_resume", fake_tailor)
    rid = client.post("/api/resumes", json={"name": "t", "latex": LATEX}).json()["id"]
    r = client.post("/api/tasks", json={"kind": "tailor", "resume_id": rid, "payload": {"job_description": "Python", "company": "Acme"}})
    assert r.status_code == 202
    tid = r.json()["id"]
    first = client.get(f"/api/tasks/{tid}").json()
    assert first["status"] in ("queued", "running")  # the request returned immediately, work is in the background
    assert any(t["id"] == tid for t in client.get(f"/api/tasks?resume_id={rid}&active=true").json())
    for _ in range(50):
        done = client.get(f"/api/tasks/{tid}").json()
        if done["status"] == "done":
            break
        time.sleep(0.1)
    assert done["status"] == "done" and done["result"]["estimated_fit"] == 71 and done["label"] == "Acme"
    assert client.delete(f"/api/tasks/{tid}").status_code == 204
    assert client.get(f"/api/tasks/{tid}").status_code == 404


def test_async_task_reports_errors(client, monkeypatch):
    import time

    from fastapi import HTTPException

    from app.services import tasks as task_service

    async def boom(*a, **k):
        raise HTTPException(400, "No OpenAI API key configured. Add one in Settings.")

    monkeypatch.setattr(task_service, "tailor_resume", boom)
    rid = client.post("/api/resumes", json={"name": "t", "latex": LATEX}).json()["id"]
    tid = client.post("/api/tasks", json={"kind": "tailor", "resume_id": rid, "payload": {"job_description": "x"}}).json()["id"]
    for _ in range(50):
        t = client.get(f"/api/tasks/{tid}").json()
        if t["status"] == "error":
            break
        time.sleep(0.1)
    assert t["status"] == "error" and "API key" in t["error"]


# ---------- templates ----------
def test_every_template_renders_valid_ats_friendly_latex():
    from app.services import templates as t, texguard

    for meta in t.TEMPLATES:
        src = t.render(meta["id"])
        assert "<<" not in src, f"{meta['id']}: unfilled placeholder"
        pre, body, _ = texguard.split_document(src)
        assert texguard.lint(body) == [], f"{meta['id']}: {texguard.lint(body)}"
        macros = texguard.custom_macros(pre)
        assert {"\\resumeEntry", "\\resumeItem", "\\resumeSkill", "\\resumeHeader"} <= set(macros), meta["id"]
        for banned in ("\\includegraphics", "fontawesome", "paracol", "multicol", "tabular", "tikz"):
            assert banned not in src, f"{meta['id']} uses {banned}, which hurts ATS parsing"
        assert "\\pdfgentounicode=1" in src
        for h in ("Education", "Experience", "Projects", "Skills"):
            assert f"\\section{{{h}}}" in src, f"{meta['id']} is missing the standard '{h}' heading"


def test_template_profile_values_are_escaped():
    from app.services import templates as t

    src = t.render("classic", "letterpaper", {"full_name": "R&D Lead_100%", "email": "a_b@x.com", "github": "https://github.com/a_b?x=1#top"})
    assert "R\\&D Lead\\_100\\%" in src and "letterpaper" in src
    assert r"\href{https://github.com/a_b?x=1\#top}" in src


def test_create_resume_from_template(client):
    client.put("/api/profile", json={"full_name": "Grace Hopper", "email": "grace@example.com", "city": "Pune"})
    r = client.post("/api/resumes/from-template", json={"template_id": "classic", "paper": "letterpaper"})  # classic is on the free plan
    assert r.status_code == 201
    body = r.json()
    assert "Grace Hopper" in body["latex"] and "letterpaper" in body["latex"] and body["name"] == "Classic resume"
    assert client.post("/api/resumes/from-template", json={"template_id": "nope"}).status_code == 404
    assert any(t["id"] == "academic" for t in client.get("/api/templates").json())


def test_companies_are_paginated_searchable_and_filterable(client):
    a = client.get("/api/jobs/companies?page=1&page_size=10").json()
    assert len(a["items"]) == 10 and a["total"] >= 150 and a["pages"] == -(-a["total"] // 10)
    b = client.get("/api/jobs/companies?page=2&page_size=10").json()
    assert {c["name"] for c in a["items"]}.isdisjoint({c["name"] for c in b["items"]})
    assert [c["name"] for c in a["items"]] == sorted((c["name"] for c in a["items"]), key=str.lower)
    s = client.get("/api/jobs/companies?q=amaz").json()
    assert [c["name"] for c in s["items"]] == ["Amazon"]
    w = client.get("/api/jobs/companies?ats=workday&page_size=100").json()
    assert w["total"] >= 5 and all(c["ats"] == "workday" for c in w["items"])
    assert sum(x["count"] for x in w["sources"]) == client.get("/api/jobs/companies?page_size=1").json()["total"]
    last = client.get("/api/jobs/companies?page=999&page_size=10").json()
    assert last["page"] == last["pages"] and last["items"]  # out-of-range pages clamp instead of returning nothing
    idx = client.get("/api/jobs/companies/index")
    assert idx.status_code == 200 and "public" in idx.headers["cache-control"] and len(idx.json()) >= 150


def test_preferences_validate_and_persist(client):
    d = client.get("/api/preferences").json()
    assert d["theme"] == "system" and d["ai_strictness"] == "strict"
    d.update(theme="dark", editor_font_size=15, blocked_companies=["Acme ", "acme", "Beta", ""])
    r = client.put("/api/preferences", json=d)
    assert r.status_code == 200 and r.json()["blocked_companies"] == ["Acme", "Beta", "acme"]
    assert client.get("/api/preferences").json()["theme"] == "dark"
    assert client.put("/api/preferences", json={**d, "editor_font_size": 99}).status_code == 422
    assert client.put("/api/preferences", json={**d, "theme": "neon"}).status_code == 422
    client.put("/api/preferences", json={**d, "theme": "system", "editor_font_size": 13, "blocked_companies": []})


def test_exclude_param_hides_companies_and_system_and_export(client, fresh_cache):
    fresh_cache("off")
    jid = _add_job(eid="x", title="Exclude Me Role")
    assert any(j["id"] == jid for j in client.get("/api/jobs?q=Exclude Me Role").json())
    assert not any(j["id"] == jid for j in client.get("/api/jobs?q=Exclude Me Role&exclude=Acme").json())
    sysinfo = client.get("/api/system").json()
    assert sysinfo["counts"]["jobs"] >= 1 and "cache_backend" in sysinfo
    exp = client.get("/api/export")
    assert exp.status_code == 200 and "attachment" in exp.headers["content-disposition"] and "openai" not in exp.text.lower()


def test_hide_below_keeps_unscored_jobs(client, fresh_cache):
    import uuid

    fresh_cache("off")
    tag = "HB" + uuid.uuid4().hex[:8]
    unscored = _add_job(eid="u", title=tag + " unscored")
    low = _add_job(client.user_id, eid="l", title=tag + " low", score=20)
    high = _add_job(client.user_id, eid="h", title=tag + " high", score=90)
    ids = {j["id"] for j in client.get(f"/api/jobs?q={tag}&hide_below=50").json()}
    assert ids == {unscored, high} and low not in ids
    assert {j["id"] for j in client.get(f"/api/jobs?q={tag}&min_score=50").json()} == {high}  # the old strict filter is unchanged


def test_latex_backslashes_survive_the_wire_format(monkeypatch):
    """Regression: LaTeX inside a JSON string decoded \\begin as backspace+egin and \\newcommand as newline+ewcommand."""
    from app.services.tailor import parse_reply

    body = "\\section{Experience}\n\\begin{entry}{Role, Acme}\n\\item \\textbf{Built} a \\footnotesize thing\n\\end{entry}\n\\newcommand{\\x}{y}\n\\resumeItem{r}"
    meta, got = parse_reply(_reply(body, changes=["a"], estimated_fit=61))
    assert got.strip() == body and meta["estimated_fit"] == 61
    assert not any(c in got for c in "\x08\x0c\x0b\r"), "control characters mean an escape sequence was decoded"
    # and a reply that ignores the format still yields a body rather than crashing
    assert parse_reply("just some text")[1] == "just some text"


def test_estimated_fit_placeholders_are_not_shown(monkeypatch):
    body = RESUME.split(r"\begin{document}")[1].split(r"\end{document}")[0]
    for raw, expected in ((0, None), ("0", None), ("85", 85), (None, None), (140, None), ("n/a", None)):
        _fake_pipeline(monkeypatch, [_reply(body, changes=["a"], estimated_fit=raw)])
        assert _run_tailor().estimated_fit == expected, raw


# ---------- hiring-manager scoring ----------
def test_manager_score_is_grounded_in_the_resume_text():
    from app.services import hiring

    resume = "Built REST APIs in Java and Spring Boot with PostgreSQL. Cut p95 latency 40%. Solved 400 LeetCode problems."
    raw = {"must_haves": [{"term": "Java", "evidence": "Built REST APIs in Java"}, {"term": "Kafka", "evidence": "used Kafka at scale"}, {"term": "PostgreSQL", "evidence": "PostgreSQL"}],
           "technical_fit": 95, "impact": 80, "scope_fit": 80, "learning_agility": 80, "strengths": ["a"], "gaps": ["b"], "summary": "x"}
    d = hiring.finalize(raw, resume)
    kafka = next(m for m in d["must_haves"] if m["term"] == "Kafka")
    assert kafka["met"] is False and kafka["evidence"] == "", "the model's evidence claim for a skill that is not in the resume must be discarded"
    assert d["dimensions"]["technical_fit"] == round(0.5 * 95 + 0.5 * 100 * 2 / 3)  # judgement blended with verified coverage
    assert d["verdict"] in ("yes", "maybe")


def test_manager_knockout_caps_score_and_verdict_matches_number():
    from app.services import hiring

    strong = {"must_haves": [], "technical_fit": 95, "impact": 95, "scope_fit": 95, "learning_agility": 95}
    assert hiring.finalize(strong, "x")["verdict"] == "strong_yes"
    ko = hiring.finalize({**strong, "knockouts": [{"issue": "Requires graduation in 2025", "fix": "cannot be fixed by editing"}]}, "x")
    assert ko["score"] == 45 and ko["verdict"] == "no" and ko["knockouts"][0]["issue"].startswith("Requires")
    assert [hiring.verdict_for(n, False) for n in (90, 70, 55, 30)] == ["strong_yes", "yes", "maybe", "no"]
    assert hiring.finalize("garbage", "x") is None


def test_score_endpoint_stores_the_evaluation(client, monkeypatch):
    import uuid

    from app.routers import jobs as jobs_router

    jid = _add_job(eid="s", title="Score Me " + uuid.uuid4().hex[:6], description="Needs Java and Spring Boot. Requires 0-2 years.")
    rid = client.post("/api/resumes", json={"name": "r", "latex": r"\documentclass{article}\begin{document}Built REST APIs in Java and Spring Boot.\end{document}"}).json()["id"]

    async def fake(db, system, user, temperature=0.3):
        return {"evaluation": {"id": jid, "must_haves": [{"term": "Java", "evidence": "Built REST APIs in Java"}], "technical_fit": 80, "impact": 70,
                                  "scope_fit": 75, "learning_agility": 70, "strengths": ["Ships APIs"], "gaps": ["No Kafka"], "interview_focus": ["Design"], "summary": "Solid backend fundamentals."}}

    monkeypatch.setattr(jobs_router, "json_chat", fake)
    assert client.post("/api/jobs/score", json={"resume_id": rid, "job_ids": [jid]}).json() == {"scored": 1}
    job = next(j for j in client.get(f"/api/jobs?q=Score Me").json() if j["id"] == jid)
    assert job["score_detail"]["verdict"] in ("yes", "strong_yes", "maybe") and job["score_reason"] == "Solid backend fundamentals."
    assert job["score_detail"]["strengths"] == ["Ships APIs"] and job["score"] == job["score_detail"]["score"]


def test_each_role_is_reviewed_in_its_own_call_and_one_failure_does_not_lose_the_rest(client, monkeypatch):
    import uuid

    from fastapi import HTTPException

    from app.routers import jobs as jobs_router

    tag = uuid.uuid4().hex[:6]
    ids = [_add_job(eid=str(i), title=f"Batch {tag} {i}", description="Needs Java.") for i in range(3)]
    rid = client.post("/api/resumes", json={"name": "r", "latex": r"\documentclass{article}\begin{document}Java and Spring.\end{document}"}).json()["id"]
    calls = []

    async def fake(db, system, user, temperature=0.3):
        jid = ids[int(user.split(f"Batch {tag} ")[1][0])]
        calls.append(jid)
        if jid == ids[1]:
            raise HTTPException(502, "OpenAI error: boom")
        return {"evaluation": {"id": jid, "must_haves": [], "technical_fit": 70, "impact": 70, "scope_fit": 70, "learning_agility": 70, "summary": "ok"}}

    monkeypatch.setattr(jobs_router, "json_chat", fake)
    r = client.post("/api/jobs/score", json={"resume_id": rid, "job_ids": ids, "limit": 3})
    assert r.json() == {"scored": 2} and sorted(calls) == sorted(ids), "one call per job; the failing one must not discard the others"

    async def always_fail(db, system, user, temperature=0.3):
        raise HTTPException(400, "No OpenAI API key configured. Add one in Settings.")

    monkeypatch.setattr(jobs_router, "json_chat", always_fail)
    j2 = _add_job(eid="z" + tag, title=f"Fresh {tag}", description="x")
    bad = client.post("/api/jobs/score", json={"resume_id": rid, "job_ids": [j2], "limit": 1})
    assert bad.status_code == 400 and "API key" in bad.json()["detail"], "when nothing works the user must see why, not a silent zero"


def test_experience_years_counts_only_work_sections_and_merges_overlap():
    from datetime import date

    from app.services import hiring

    tex = r"""\section{Experience}
Backend Engineer Jan 2024 -- Present
Intern Jun 2023 -- Aug 2023
Side gig Mar 2024 -- Jun 2024
\section{Education}
B.Tech Aug 2020 -- May 2024
\section{Projects}
Thing Jan 2022 -- Dec 2022"""
    # Jun-Aug 2023 = 3 months; Jan 2024..Nov 2026 = 35 months (the Mar-Jun side gig overlaps and adds nothing)
    assert hiring.experience_years(tex, today=date(2026, 11, 8)) == round((3 + 35) / 12, 1)
    assert hiring.experience_years(r"\section{Projects} Jan 2022 -- Dec 2022") is None


def test_required_years_reads_stated_minimums_only_near_experience():
    from app.services import hiring

    assert hiring.required_years("You have 3+ years of professional experience building services") == 3
    assert hiring.required_years("At least 2 years of software development experience") == 2
    assert hiring.required_years("We were founded 10+ years ago and love our team") is None
    assert hiring.required_years("0-2 years of experience") is None


def test_missing_minimum_years_becomes_a_knockout_even_if_the_model_forgot():
    from datetime import date

    from app.services import hiring

    resume_tex = r"\section{Experience} Dev Jan 2026 -- Mar 2026"  # fixed dates: "Present" would drift with the calendar
    raw = {"must_haves": [], "technical_fit": 90, "impact": 90, "scope_fit": 90, "learning_agility": 90, "gaps": [], "summary": "Great candidate"}
    d = hiring.finalize(raw, "Dev", "Needs 5+ years of professional experience", resume_tex)
    assert d["verdict"] == "no" and d["score"] <= 45 and "5+ years" in d["knockouts"][0]["issue"]
    assert d["summary"].startswith("Pass for now"), "the headline must not contradict the verdict"
    near = hiring.finalize(raw, "Dev", "Needs 3+ years of experience", r"\section{Experience} Dev Jan 2025 -- Dec 2026")  # exactly 2.0 years
    assert near["score"] <= 70 and not near["knockouts"] and "under the stated" in near["gaps"][0]


def test_non_skills_and_category_words_are_handled_fairly():
    from app.services import hiring

    resume = "Built services with Spring Boot, PostgreSQL and AWS Lambda; wrote JUnit tests."
    raw = {"must_haves": [{"term": "Bachelor's degree"}, {"term": "collaborative coding"}, {"term": "cloud platforms"}, {"term": "databases"}, {"term": "programming language"}, {"term": "Kafka"}],
           "technical_fit": 80, "impact": 70, "scope_fit": 70, "learning_agility": 70}
    d = hiring.finalize(raw, resume)
    terms = {m["term"]: m["met"] for m in d["must_haves"]}
    assert "Bachelor's degree" not in terms and "collaborative coding" not in terms, "non-skills must not be scored as skills"
    assert terms["cloud platforms"] and terms["databases"] and not terms["Kafka"]


def test_strong_yes_needs_every_verified_must_have():
    from app.services import hiring

    base = {"technical_fit": 95, "impact": 95, "scope_fit": 95, "learning_agility": 95}
    full = hiring.finalize({**base, "must_haves": [{"term": "Java"}, {"term": "PostgreSQL"}]}, "Java and PostgreSQL")
    partial = hiring.finalize({**base, "must_haves": [{"term": "Java"}, {"term": "Kafka"}]}, "Java only")
    assert full["verdict"] == "strong_yes" and partial["verdict"] != "strong_yes"
