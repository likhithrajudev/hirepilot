"""ATS emulation: parse the compiled PDF like a machine would, verify keyword coverage in code, and let the model
act as the screening layer (knockouts, experience fit, impact). Proprietary systems at big companies are not public,
so this emulates how enterprise screening generally works rather than copying any one vendor."""
import io
import re
from typing import Any, Optional

from sqlalchemy.orm import Session

from . import latex as latex_service
from .llm import json_chat

ATS_SYSTEM = """You emulate the resume-screening pipeline used by large employers (Microsoft, Amazon, Google, Meta, Apple, Netflix and similar) for all kinds of engineering roles. Think in the same order they do:

1. PARSE: what a machine can read. You are given the text extracted from the candidate's PDF, exactly as an ATS would see it.
2. KNOCKOUTS: hard requirements that auto-reject (required degree or graduation window, minimum years of experience, required language/skill, work authorisation, location). Only flag what the job description actually states.
3. MUST-HAVE vs NICE-TO-HAVE: split the job description's requirements. Must-haves are stated as required/minimum/"you have". Nice-to-haves are preferred/bonus.
4. RECRUITER SKIM (6 seconds): titles, companies, recency, impact numbers, stack.

Be strict and discriminating like a real screen. Never reward keyword stuffing. Judge only evidence present in the resume text; do not assume skills.

Return one JSON object:
{
 "must_have": [{"term": "<short skill/requirement, 1-4 words>", "found": true|false, "evidence": "<<=12 word quote from the resume, or empty>"}],
 "nice_to_have": [same shape],
 "knockouts": [{"issue": "<what could get auto-rejected>", "severity": "high|medium|low", "fix": "<honest fix or 'cannot be fixed by editing'>"}],
 "experience_fit": {"score": 0-100, "note": "<1 sentence: title/seniority/domain alignment>"},
 "impact": {"score": 0-100, "note": "<1 sentence: quantified, outcome-led bullets?>"},
 "education": {"score": 0-100, "note": "<1 sentence>"},
 "recruiter_skim": "<2 sentences: what a recruiter would notice in 6 seconds, good and bad>",
 "top_fixes": ["<5 concrete, truthful edits in priority order; never suggest inventing experience>"],
 "bullet_feedback": [{"original": "<existing bullet text>", "suggestion": "<stronger rewrite using only facts already present>", "why": "<short>"}]
}
Limit: 6-14 must_have, up to 8 nice_to_have, up to 5 bullet_feedback."""

# Normalises common spellings so "Postgres" in the resume satisfies "PostgreSQL" in the job description.
_ALIAS_GROUPS = [
    ("postgresql", "postgres"), ("kubernetes", "k8s"), ("javascript", "js"), ("typescript", "ts"),
    ("golang", "go"), ("node.js", "nodejs", "node js", "node"), ("react", "reactjs", "react.js"),
    ("amazon web services", "aws"), ("google cloud", "gcp", "google cloud platform"), ("ci/cd", "cicd", "ci cd"),
    ("rest apis", "rest api", "restful", "rest"), ("machine learning", "ml"), ("data structures", "dsa"),
    ("object oriented", "oop", "object-oriented"), ("microservices", "micro-services", "micro services"),
    ("spring boot", "springboot"), ("c++", "cpp"), ("c#", "csharp"), ("mongodb", "mongo"),
]
_ALIASES = {a: g for g in _ALIAS_GROUPS for a in g}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9+#./ ]+", " ", s.lower())


def term_present(term: str, text: str) -> bool:
    t = term.strip()
    if not t:
        return False
    low = _norm(text)
    for variant in _ALIASES.get(t.lower(), (t.lower(),)):
        v = _norm(variant).strip()
        if len(v) <= 2 and not re.search(rf"(?<![A-Za-z0-9]){re.escape(variant)}(?![A-Za-z0-9])", text):
            continue
        if re.search(rf"(?<![a-z0-9]){re.escape(v)}(?![a-z0-9])", low):
            return True
    words = [w for w in _norm(t).split() if len(w) > 2]
    return len(words) > 1 and all(re.search(rf"(?<![a-z0-9]){re.escape(w)}(?![a-z0-9])", low) for w in words)


def extract_pdf_text(pdf: bytes) -> tuple[str, int]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf))
    return "\n".join((p.extract_text() or "") for p in reader.pages).strip(), len(reader.pages)


_SECTIONS = {
    "Experience": r"experience|employment|work history",
    "Education": r"education|academic",
    "Skills": r"skills|technologies|technical",
    "Projects": r"projects?",
}


def parse_checks(latex_src: str, text: str, pages: Optional[int]) -> tuple[int, list[dict[str, str]]]:
    """Deterministic parseability checks. Returns (score 0-100, findings)."""
    checks: list[dict[str, str]] = []
    score = 100

    def add(level: str, msg: str, cost: int = 0) -> None:
        nonlocal score
        score -= cost
        checks.append({"level": level, "message": msg})

    low = text.lower()
    if not text or len(text) < 200:
        add("bad", "Almost no text could be extracted from the PDF. An ATS would see an empty resume.", 60)
    if re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text):
        add("ok", "Email address is machine-readable.")
    else:
        add("bad", "No email address found in the extracted text.", 15)
    if re.search(r"(\+?\d[\d\s().-]{8,}\d)", text):
        add("ok", "Phone number is machine-readable.")
    else:
        add("warn", "No phone number found in the extracted text.", 5)
    missing = [n for n, pat in _SECTIONS.items() if not re.search(rf"^\s*(?:{pat})\b", text, re.I | re.M)]
    if not missing:
        add("ok", "Standard section headings detected (Experience, Education, Skills, Projects).")
    else:
        add("warn", "Section headings not clearly detected: " + ", ".join(missing) + ". Use plain standard names.", 4 * len(missing))
    if re.search(r"\\usepackage(\[[^\]]*\])?\{(paracol|multicol)\}|\\begin\{(paracol|multicols)\}", latex_src):
        add("warn", "Multi-column layout (paracol/multicol). Many ATS read columns out of order. Verify the extracted text below.", 8)
    if re.search(r"\\includegraphics|\\begin\{tikzpicture\}", latex_src):
        add("bad", "Images or drawings are invisible to an ATS and may hide content.", 10)
    if "fontawesome" in latex_src.lower():
        add("warn", "Icon glyphs (fontawesome) can extract as stray symbols. Keep real words next to every icon.", 4)
    if re.search(r"[\uE000-\uF8FF\uFFFD]", text):
        add("bad", "Private-use/garbled characters in extracted text: some glyphs will parse as junk.", 8)
    if re.search(r"\\begin\{tabular", latex_src):
        add("warn", "Tables used for layout can scramble reading order in some ATS.", 4)
    if pages is not None and pages > 1:
        add("warn", f"{pages} pages. For early-career roles recruiters expect one page.", 4 if pages == 2 else 10)
    elif pages == 1:
        add("ok", "Single page.")
    if not re.search(r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\b\d{4}\s*[-–]\s*(?:\d{4}|present)", low):
        add("warn", "No parseable date ranges found. ATS uses dates to compute experience.", 6)
    return max(0, min(100, score)), checks


def _items(raw: Any, text: str) -> list[dict[str, Any]]:
    out = []
    for it in raw if isinstance(raw, list) else []:
        if not isinstance(it, dict) or not str(it.get("term", "")).strip():
            continue
        term = str(it["term"]).strip()[:60]
        # Never trust the model's "found": verify it against the resume text.
        found = term_present(term, text)
        out.append({"term": term, "found": found, "evidence": str(it.get("evidence", ""))[:120] if found else ""})
    return out[:16]


def _sub(d: Any) -> dict[str, Any]:
    d = d if isinstance(d, dict) else {}
    try:
        sc = max(0, min(100, int(d.get("score", 0))))
    except (TypeError, ValueError):
        sc = 0
    return {"score": sc, "note": str(d.get("note", ""))[:300]}


def _verdict(n: int) -> str:
    return "strong" if n >= 80 else "good" if n >= 65 else "borderline" if n >= 50 else "weak"


async def analyze(
    db: Session, latex_src: str, jd: str, company: Optional[str] = None, title: Optional[str] = None
) -> dict[str, Any]:
    compiled = await latex_service.compile_latex(latex_src)
    pages: Optional[int] = None
    if compiled.ok and compiled.pdf:
        try:
            text, pages = extract_pdf_text(compiled.pdf)
        except Exception:
            text = latex_service.latex_to_text(latex_src)
    else:
        text = latex_service.latex_to_text(latex_src)
    parse_score, parse_findings = parse_checks(latex_src, text, pages)
    if not compiled.ok:
        parse_findings.insert(0, {"level": "bad", "message": "The resume does not compile, so no PDF exists for an ATS to read."})
        parse_score = min(parse_score, 20)

    user = (
        f"Company: {company or 'unspecified'}\nRole: {title or 'unspecified'}\n\n"
        f"=== JOB DESCRIPTION ===\n{jd.strip()[:12000]}\n\n"
        f"=== TEXT AN ATS EXTRACTED FROM THE RESUME PDF ===\n{text[:9000]}"
    )
    data = await json_chat(db, ATS_SYSTEM, user, temperature=0.1)

    must = _items(data.get("must_have"), text)
    nice = _items(data.get("nice_to_have"), text)
    m_cov = sum(i["found"] for i in must) / len(must) if must else 0.0
    n_cov = sum(i["found"] for i in nice) / len(nice) if nice else m_cov
    kw_score = round(100 * (0.75 * m_cov + 0.25 * n_cov))
    exp, imp, edu = _sub(data.get("experience_fit")), _sub(data.get("impact")), _sub(data.get("education"))
    overall = round(0.35 * kw_score + 0.25 * exp["score"] + 0.15 * imp["score"] + 0.05 * edu["score"] + 0.20 * parse_score)
    high_knockout = any(isinstance(k, dict) and k.get("severity") == "high" for k in data.get("knockouts", []) or [])
    if high_knockout:
        overall = min(overall, 55)  # a real screen rejects on a hard knockout regardless of keywords

    def lst(key: str, n: int) -> list[Any]:
        v = data.get(key)
        return v[:n] if isinstance(v, list) else []

    return {
        "overall": overall,
        "verdict": _verdict(overall),
        "dimensions": [
            {"key": "keywords", "label": "Keyword match", "score": kw_score,
             "note": f"{sum(i['found'] for i in must)}/{len(must)} must-haves, {sum(i['found'] for i in nice)}/{len(nice)} nice-to-haves found in your resume text."},
            {"key": "experience", "label": "Experience fit", **exp},
            {"key": "impact", "label": "Impact & results", **imp},
            {"key": "education", "label": "Education", **edu},
            {"key": "parse", "label": "ATS parseability", "score": parse_score,
             "note": "Computed from the actual compiled PDF text."},
        ],
        "must_have": must,
        "nice_to_have": nice,
        "knockouts": [k for k in lst("knockouts", 6) if isinstance(k, dict)],
        "parse_findings": parse_findings,
        "recruiter_skim": str(data.get("recruiter_skim", ""))[:600],
        "top_fixes": [str(x) for x in lst("top_fixes", 6)],
        "bullet_feedback": [b for b in lst("bullet_feedback", 5) if isinstance(b, dict)],
        "ats_text": text[:7000],
        "pages": pages,
        "compiled": compiled.ok,
    }
