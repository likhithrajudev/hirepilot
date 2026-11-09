"""Scores a candidate against a job the way an engineering manager decides whether to spend an interview slot.

The model supplies judgement (what a manager would weigh); code supplies discipline: must-have skills are verified
against the resume text, a hard knockout caps the score, and the verdict is derived from the final number so the
explanation can never contradict it.
"""
import re
from datetime import date
from typing import Any, Optional

from . import ats as ats_service

SYSTEM = """You are an engineering manager deciding whether to spend a 45-minute interview slot on a candidate for an EARLY-CAREER engineering role. You read the resume the way a busy, experienced manager does: trajectory and evidence over keywords.

Think in this order:
1. KNOCKOUTS stated in the posting: required degree or graduation window, minimum years, required language, work authorisation, location. A real knockout means no interview regardless of anything else.
2. MUST-HAVES: the 3-8 TECHNICAL skills, tools, languages or concepts the posting treats as required (never degree, graduation date, availability, location or work authorisation: those belong only in knockouts, and only if the candidate clearly fails them). For each, is there concrete evidence in the resume (a project, role or result)? Listing a word in a skills section is weak evidence; shipping something with it is strong.
3. EVIDENCE OF IMPACT: owned versus assisted, real scale or users, measured outcomes, quality of engineering (tests, reliability, design decisions).
4. SCOPE AND RAMP: for an early-career hire, will they ramp into THIS team's work within a few months? Do their projects look like the job?
5. LEARNING AGILITY: breadth gained quickly, increasing responsibility, open source, competitive programming, initiative.
6. RISKS: gaps a manager would worry about, and what you would probe in the first screen.

The reader sees only this one posting. Never mention job ids, numbers that identify a posting, or other postings ("similar to job 42" is meaningless to them). Refer to the role by what it is.

Calibrate honestly. Most applicants are a "maybe" or "no" for any specific role. A strong yes is rare and needs clear evidence on the must-haves. Do not reward keyword stuffing. Do not assume skills that are not on the page. Judge only the resume text provided.

Return JSON: {"evaluation": {
 "must_haves": [{"term": "<1-4 words>", "evidence": "<<=14 words from the resume, or empty if none>"}],
 "knockouts": [{"issue": "<what, citing the posting>", "fix": "<honest fix, or 'cannot be fixed by editing'>"}],
 "technical_fit": 0-100, "impact": 0-100, "scope_fit": 0-100, "learning_agility": 0-100,
 "strengths": ["<=3 items, each citing specific resume evidence>"],
 "gaps": ["<=3 specific missing or weak areas relative to the posting>"],
 "interview_focus": ["<=3 things you would probe in the screen"],
 "summary": "<one sentence, max 120 words, in a hiring manager's voice: the decisive reason>"
}}"""

WEIGHTS = {"technical_fit": 0.35, "impact": 0.25, "scope_fit": 0.20, "learning_agility": 0.20}


_REF = re.compile(
    r"\(\s*(?:see|cf\.?|compare)?\s*(?:job|posting|role|position|listing|opening)s?\s*(?:id|#|no\.?|number)?\s*[:=#]?\s*\d+\s*\)\s*"
    r"|(?:\b(?:similar to|same as|comparable to|just like|like|as with|compared (?:to|with))\s+)?"
    r"\b(?:job|posting|role|position|listing|opening)s?\s*(?:id|#|no\.?|number)?\s*[:=#]?\s*\d+\b[,;:]?\s*"
    r"|\[?\bid\s*=\s*\d+\]?\s*", re.I)


def scrub(text: Optional[str]) -> str:
    """Remove references to internal posting ids from model-written text. They mean nothing to the person reading it."""
    if not text:
        return ""
    out = re.sub(r"\s{2,}", " ", _REF.sub("", text)).strip(" ,;:-")
    return (out[:1].upper() + out[1:]) if out else ""


# ---------- facts computed in code, so the verdict never depends on the model remembering to check ----------
_MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
_RANGE = re.compile(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\s*(?:-|\u2013|\u2014|--|to)+\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})|(present|current|now|ongoing))", re.I)


def experience_years(resume_latex: str, today: Optional[date] = None) -> Optional[float]:
    """Years of work experience from the date ranges in Experience-type sections only (education and projects are excluded).
    Overlapping ranges are merged so two simultaneous roles are not double counted."""
    today = today or date.today()
    parts = re.split(r"\\section\*?\{([^}]*)\}", resume_latex)
    spans: list[tuple[int, int]] = []
    for title, body in zip(parts[1::2], parts[2::2]):
        if not re.search(r"experience|employment|work history|internship", title, re.I):
            continue
        for m in _RANGE.finditer(body):
            start = int(m.group(2)) * 12 + _MONTHS[m.group(1).lower()[:3]]
            end = today.year * 12 + today.month if m.group(5) else int(m.group(4)) * 12 + _MONTHS[m.group(3).lower()[:3]]
            if end >= start:
                spans.append((start, end + 1))
    if not spans:
        return None
    spans.sort()
    total, cur_s, cur_e = 0, spans[0][0], spans[0][1]
    for st, en in spans[1:]:
        if st <= cur_e:
            cur_e = max(cur_e, en)
        else:
            total += cur_e - cur_s
            cur_s, cur_e = st, en
    return round((total + cur_e - cur_s) / 12, 1)


_REQ = re.compile(r"(?:at least|minimum(?: of)?|min\.?)?\s*(\d{1,2})\s*\+\s*years?|(?:at least|minimum(?: of)?)\s+(\d{1,2})\s+years?", re.I)


def required_years(job_text: str) -> Optional[int]:
    """Largest stated minimum like "3+ years" or "at least 2 years" that sits next to the word experience."""
    best = None
    for m in _REQ.finditer(job_text):
        n = int(m.group(1) or m.group(2))
        window = job_text[max(0, m.start() - 80) : m.end() + 120].lower()
        if "experience" in window and 1 <= n <= 15:
            best = max(best or 0, n)
    return best


# Category words a posting uses that no resume spells out: satisfied by any concrete member.
_CATEGORIES = {
    "cloud": r"aws|azure|gcp|google cloud|cloud|lambda|ec2|s3|kubernetes|docker",
    "database": r"sql|postgres|mysql|mongo|redis|dynamo|cassandra|database",
    "programming language": r"java|python|c\+\+|golang|\bgo\b|rust|kotlin|scala|ruby|javascript|typescript|c#",
    "distributed system": r"kafka|microservice|distributed|queue|rabbit|grpc|event-driven",
    "api": r"rest|api|graphql|grpc",
    "testing": r"junit|pytest|unit test|integration test|test",
}
# Requirements that are not skills: they belong in knockouts, and must never drag technical fit down.
_NOT_A_SKILL = re.compile(r"degree|bachelor|master|ph\.?d|graduat|availab|location|authori[sz]|visa|sponsor|\byears?\b|communicat|collaborat|team ?work|passion|motivat|curios|work ethic|fast learner", re.I)


def skill_present(term: str, resume_text: str) -> bool:
    low = term.lower()
    for key, members in _CATEGORIES.items():
        if key in low and not re.search(r"\b(c|r)\b", low):
            return bool(re.search(members, resume_text, re.I))
    return ats_service.term_present(term, resume_text)


def verdict_for(score: int, knockout: bool, coverage: Optional[float] = None) -> str:
    if knockout:
        return "no" if score < 50 else "maybe"
    if score >= 85 and (coverage is None or coverage >= 1.0):  # "strong yes" is rare: every checked must-have has evidence
        return "strong_yes"
    return "yes" if score >= 68 else "maybe" if score >= 50 else "no"


def _n(v: Any) -> int:
    try:
        return max(0, min(100, int(v)))
    except (TypeError, ValueError):
        return 0


def _strs(v: Any, n: int, width: int = 220) -> list[str]:
    return [t for t in (scrub(str(x)[:width]) for x in v[:n]) if t] if isinstance(v, list) else []


def finalize(raw: dict[str, Any], resume_text: str, job_text: str = "", resume_latex: str = "") -> Optional[dict[str, Any]]:
    """Turn one model evaluation into the stored record. Returns None if the model gave nothing usable."""
    if not isinstance(raw, dict):
        return None
    musts = []
    for m in raw.get("must_haves") or []:
        if isinstance(m, dict) and str(m.get("term", "")).strip() and not _NOT_A_SKILL.search(str(m["term"])):
            term = str(m["term"]).strip()[:60]
            found = skill_present(term, resume_text)  # never trust the model's claim, check the text
            musts.append({"term": term, "met": found, "evidence": str(m.get("evidence", ""))[:140] if found else ""})
    coverage = (sum(m["met"] for m in musts) / len(musts)) if musts else None
    tf = _n(raw.get("technical_fit"))
    if coverage is not None:  # blend judgement with verified coverage so an unsupported "great fit" cannot stand
        tf = round(0.5 * tf + 0.5 * 100 * coverage)
    dims = {"technical_fit": tf, "impact": _n(raw.get("impact")), "scope_fit": _n(raw.get("scope_fit")), "learning_agility": _n(raw.get("learning_agility"))}
    score = round(sum(dims[k] * w for k, w in WEIGHTS.items()))
    knock = [k for k in (raw.get("knockouts") or []) if isinstance(k, dict) and str(k.get("issue", "")).strip()]
    gaps = _strs(raw.get("gaps"), 3)
    summary = scrub(str(raw.get("summary", ""))[:300])
    # Stated minimum years of experience, checked against the dates in the resume rather than the model's memory.
    need, have = required_years(job_text), experience_years(resume_latex) if resume_latex else None
    if need and need >= 2 and have is not None:
        if have < need * 0.5:
            if not any(re.search(r"year|experience", str(k.get("issue", "")), re.I) for k in knock):
                knock.append({"issue": f"Posting requires {need}+ years of experience; the resume shows about {have:g}", "fix": "cannot be fixed by editing"})
            summary = f"Pass for now: the posting asks for {need}+ years and the resume shows about {have:g}."
        elif have < need * 0.9:
            score = min(score, 70)
            gaps = [f"Slightly under the stated {need}+ years of experience (about {have:g})"] + [g for g in gaps if "year" not in g.lower()][:2]
    if knock:
        score = min(score, 45)  # a stated hard requirement the candidate misses ends the conversation
    return {
        "verdict": verdict_for(score, bool(knock), coverage), "score": score, "dimensions": dims, "must_haves": musts[:10],
        "knockouts": [{"issue": scrub(str(k["issue"])[:200]), "fix": scrub(str(k.get("fix", ""))[:200])} for k in knock[:3]],
        "strengths": _strs(raw.get("strengths"), 3), "gaps": gaps, "interview_focus": _strs(raw.get("interview_focus"), 3),
        "summary": summary,
    }
