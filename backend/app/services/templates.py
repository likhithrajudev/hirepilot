"""ATS-friendly resume templates. Every template shares one macro API (\\resumeEntry, \\resumeItem, ...), so the AI
tailoring step, which edits only the body, works identically on all of them."""
import asyncio
import io
import re
from pathlib import Path
from typing import Any, Optional

from . import ats as ats_service
from . import latex as latex_service

DIR = Path(__file__).parent.parent / "data" / "templates"

TEMPLATES: list[dict[str, Any]] = [
    {"id": "classic", "name": "Classic", "tagline": "Traditional serif with ruled section headings",
     "best_for": "Big tech, finance, most roles", "font": "Times", "order": ["EDU", "EXP", "PROJ", "SKILLS"]},
    {"id": "modern", "name": "Modern", "tagline": "Clean sans-serif with one accent colour",
     "best_for": "Startups and product teams", "font": "Helvetica", "order": ["EXP", "PROJ", "SKILLS", "EDU"]},
    {"id": "compact", "name": "Compact", "tagline": "Dense single page that fits more in",
     "best_for": "Many projects or internships", "font": "Latin Modern", "order": ["EDU", "EXP", "PROJ", "SKILLS"]},
    {"id": "academic", "name": "Academic", "tagline": "Roomy serif, education and research first",
     "best_for": "Research roles and graduate applications", "font": "Charter", "order": ["EDU", "PROJ", "EXP", "SKILLS"]},
    {"id": "minimal", "name": "Minimal", "tagline": "Plain-text feel, no rules or colour",
     "best_for": "Zero design noise, maximum parseability", "font": "Latin Modern", "order": ["EXP", "EDU", "PROJ", "SKILLS"]},
]
_BY_ID = {t["id"]: t for t in TEMPLATES}

SAMPLE = {"full_name": "Alex Morgan", "email": "alex.morgan@example.com", "phone": "+91 98765 43210", "city": "Bengaluru, India",
          "linkedin": "https://www.linkedin.com/in/alexmorgan", "github": "https://github.com/alexmorgan", "portfolio": ""}

BLOCKS = {
    "EDU": r"""\section{Education}
\resumeEntry{Example Institute of Technology}{Aug 2022 -- May 2026}{B.Tech in Computer Science}{Bengaluru, India}
\begin{resumeItems}
\resumeItem{CGPA 8.9/10. Coursework: Data Structures, Operating Systems, Databases, Distributed Systems.}
\end{resumeItems}""",
    "EXP": r"""\section{Experience}
\resumeEntry{Backend Engineer Intern}{Jun 2025 -- Aug 2025}{Northwind Technologies}{Bengaluru, India}
\begin{resumeItems}
\resumeItem{Built REST APIs in Java and Spring Boot that serve 1.2M requests per day for the order service.}
\resumeItem{Cut p95 latency from 480 ms to 190 ms by adding Redis caching and fixing slow PostgreSQL queries.}
\resumeItem{Wrote integration tests and CI checks that reduced failed deployments by 40\%.}
\end{resumeItems}
\resumeEntry{Open Source Contributor}{Jan 2024 -- Present}{Apache Kafka community}{Remote}
\begin{resumeItems}
\resumeItem{Fixed 6 documentation and test issues across the Kafka Streams module; 4 pull requests merged.}
\end{resumeItems}""",
    "PROJ": r"""\section{Projects}
\resumeEntry{Job Tracker API}{2025}{Java, Spring Boot, PostgreSQL, Docker}{}
\begin{resumeItems}
\resumeItem{Designed a REST service with JWT authentication, pagination and role-based access for 500+ test users.}
\resumeItem{Containerised the app with Docker Compose and added GitHub Actions for build and test on every push.}
\end{resumeItems}
\resumeEntry{Distributed Rate Limiter}{2024}{Go, Redis}{}
\begin{resumeItems}
\resumeItem{Implemented a token-bucket limiter with Redis Lua scripts; benchmarked at 25K requests per second.}
\end{resumeItems}""",
    "SKILLS": r"""\section{Skills}
\resumeSkill{Languages}{Java, Python, Go, SQL, JavaScript}
\resumeSkill{Backend}{Spring Boot, REST APIs, Kafka, Redis, PostgreSQL, Docker}
\resumeSkill{Tools}{Git, GitHub Actions, Linux, JUnit, Postman}""",
}

_SPECIAL = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}",
            "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}


def esc(s: str) -> str:
    return "".join(_SPECIAL.get(c, c) for c in s)


def _url(u: str) -> str:
    return u.replace("%", r"\%").replace("#", r"\#").replace("&", r"\&").replace(" ", "")


def _label(u: str) -> str:
    return esc(re.sub(r"^https?://(www\.)?", "", u).rstrip("/"))


def contact_line(p: dict[str, str]) -> str:
    items: list[str] = []
    if p.get("city"):
        items.append(esc(p["city"]))
    if p.get("phone"):
        items.append(esc(p["phone"]))
    if p.get("email"):
        items.append(rf"\href{{mailto:{_url(p['email'])}}}{{{esc(p['email'])}}}")
    for k in ("linkedin", "github", "portfolio"):
        if p.get(k):
            items.append(rf"\href{{{_url(p[k])}}}{{{_label(p[k])}}}")
    return r" \,\textbar\, ".join(items)


def render(template_id: str, paper: str = "a4paper", profile: Optional[dict[str, str]] = None) -> str:
    t = _BY_ID.get(template_id)
    if not t:
        raise KeyError(template_id)
    p = dict(SAMPLE)
    p.update({k: v.strip() for k, v in (profile or {}).items() if k in SAMPLE and isinstance(v, str) and v.strip()})
    src = (DIR / f"{template_id}.tex").read_text()
    body = "\n\n".join(BLOCKS[b] for b in t["order"])
    paper = paper if paper in ("a4paper", "letterpaper") else "a4paper"
    # Use a function replacement so backslashes in values are never read as regex escapes.
    out = src.replace("<<PAPER>>", paper).replace("<<FULL_NAME>>", esc(p["full_name"]))
    out = out.replace("<<CONTACT_LINE>>", contact_line(p)).replace("<<BODY>>", body)
    return out


# ---------- previews (compiled once, then cached) ----------
_cache: dict[tuple[str, str], dict[str, Any]] = {}
_locks: dict[tuple[str, str], asyncio.Lock] = {}


def _rasterise(pdf: bytes) -> bytes:
    import pypdfium2 as pdfium

    page = pdfium.PdfDocument(pdf)[0]
    img = page.render(scale=1.6).to_pil().convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


async def preview(template_id: str, paper: str = "a4paper") -> Optional[dict[str, Any]]:
    key = (template_id, paper)
    if key in _cache:
        return _cache[key]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        if key in _cache:
            return _cache[key]
        src = render(template_id, paper)
        res = await latex_service.compile_latex(src)
        if not (res.ok and res.pdf):
            return None
        text, pages = ats_service.extract_pdf_text(res.pdf)
        score, _checks = ats_service.parse_checks(src, text, pages)
        png = await asyncio.to_thread(_rasterise, res.pdf)
        _cache[key] = {"png": png, "pages": pages, "ats_parse": score}
        return _cache[key]


async def warm() -> None:
    if not latex_service.latex_available():
        return
    for t in TEMPLATES:
        try:
            await preview(t["id"], "a4paper")
        except Exception:  # a broken preview must never stop the app starting
            pass


def listing() -> list[dict[str, Any]]:
    out = []
    for t in TEMPLATES:
        c = _cache.get((t["id"], "a4paper"))
        out.append({k: t[k] for k in ("id", "name", "tagline", "best_for", "font")} | {"ats_parse": c["ats_parse"] if c else None, "pages": c["pages"] if c else None})
    return out
