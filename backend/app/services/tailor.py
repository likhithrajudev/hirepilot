"""AI tailoring. The model edits only the document body; code owns the preamble and verifies everything it writes."""
from dataclasses import dataclass
from typing import Callable, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..schemas import TailorResult
from . import ats as ats_service
from . import latex as latex_service
from . import texguard
from .llm import text_chat

SYSTEM = """You are an expert resume editor who knows how large-company ATS and recruiter screens (Microsoft, Amazon, Google, Meta, Apple and similar) read resumes. You tailor the BODY of an existing LaTeX resume to one job description so it passes the machine screen and reads well in a 6-second skim.

WHAT YOU RECEIVE AND RETURN
- You receive only the document body (the text between \\begin{document} and \\end{document}). The preamble is fixed and not yours to change.
- Return the complete new body: no \\documentclass, no \\usepackage, no \\begin{document}, no \\end{document}, no markdown fences.
- Use only commands and environments that already appear in the body or are listed as AVAILABLE. Never define new macros.

TRUTH RULES (a violation is a rejection)
1. Never add a number, percentage, year, metric, employer, title, degree, tool, language, framework or skill that is not already in the original body. You may reword, reorder, emphasise, merge and trim what is there.
2. Use the job description's vocabulary only for things the candidate already did. Spell out and abbreviate once when both forms help ("Kubernetes (K8s)") only if the candidate already uses that technology.
3. Keep every \\href target, URL, email and phone number exactly as written.

ATS-AWARE EDITING
- Lead each role with its most relevant bullet; put the most relevant projects first; start bullets with a strong verb and end with the outcome.
- Keep standard section names. Keep the same single-column structure. Do not add tables, images or text boxes.
- No keyword stuffing and no repeated skill lists. Evidence beats keyword count.
- Keep the same page count: trim the least relevant bullets rather than adding length.

LATEX SAFETY
- Escape special characters in text: write \\%, \\&, \\$, \\#, \\_ . Never write a bare % (it comments out the rest of the line, including closing braces).
- Every { has a }, every \\begin has its \\end. Keep the original indentation style.

Respond in EXACTLY this plain-text format. It is not JSON; the body is raw LaTeX with single backslashes, written as-is:
===META===
{"changes": ["3-8 short strings, each describing one meaningful change"], "matched_keywords": ["job-description keywords the resume now emphasises, only ones it truthfully supports"], "missing_keywords": ["important job-description skills the resume honestly does NOT show; do not add them"], "estimated_fit": <your honest integer estimate between 1 and 99, how well the tailored resume fits the role>}
===BODY===
<the complete new body here, raw LaTeX, nothing after it>"""


@dataclass
class TailorOptions:
    strict_terms: bool = True  # block new skills/terms; False downgrades them to warnings
    temperature: float = 0.3
    max_attempts: int = 3
    default_instructions: str = ""


def _user_prompt(body: str, macros: list[str], jd: str, company: Optional[str], title: Optional[str], extra: str, pages: Optional[int]) -> str:
    return (
        f"Company: {company or 'unspecified'}\nRole: {title or 'unspecified'}\n"
        f"Page limit: the finished resume must stay on {pages or 1} page(s).\n"
        f"Extra instructions from the candidate: {extra or 'none'}\n"
        f"AVAILABLE custom commands/environments from the preamble: {', '.join(macros) or 'none'}\n\n"
        f"=== JOB DESCRIPTION ===\n{jd.strip() or '(none provided - just tighten and polish)'}\n\n"
        f"=== CURRENT BODY (LaTeX) ===\n{body}"
    )


def _repair_prompt(prev_body: str, issues: list[str]) -> str:
    return (
        "Your previous body was rejected for these reasons:\n- " + "\n- ".join(issues)
        + "\n\nReturn a corrected body in the same JSON shape. Fix every item. Remove anything that is not in the original; "
        "do not introduce new numbers or skills.\n\n=== YOUR PREVIOUS BODY ===\n" + prev_body
    )


def parse_reply(text: str) -> tuple[dict, str]:
    """Split the plain-text reply into (metadata dict, raw LaTeX body). Metadata is best-effort; the body is what matters."""
    import json

    head, sep, body = text.rpartition("===BODY===")
    if not sep:  # the model ignored the format: treat everything as the body
        return {}, text
    meta: dict = {}
    m = head.rsplit("===META===", 1)[-1].strip()
    m = m.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        meta = json.loads(m) if m else {}
    except json.JSONDecodeError:
        meta = {}
    return (meta if isinstance(meta, dict) else {}), body


def _clean_body(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        s = s.rsplit("```", 1)[0]
    parts = texguard.split_document(s)  # the model returned a whole document anyway: keep only its body
    return (parts[1] if parts else s).strip("\n")


def _strs(v: object) -> list[str]:
    return [str(x) for x in v] if isinstance(v, list) else []


async def tailor_resume(
    db: Session,
    latex: str,
    jd: str,
    company: Optional[str] = None,
    title: Optional[str] = None,
    extra: Optional[str] = None,
    opts: Optional[TailorOptions] = None,
    on_progress: Optional[Callable[[str], None]] = None,
) -> TailorResult:
    opts = opts or TailorOptions()
    say = on_progress or (lambda _m: None)
    parts = texguard.split_document(latex)
    if not parts:
        raise HTTPException(422, "The resume has no \\begin{document} ... \\end{document}, so there is nothing to tailor.")
    pre, body, _tail = parts
    macros = texguard.custom_macros(pre)

    say("Checking that your resume compiles")
    base = await latex_service.compile_latex(latex)
    base_pages: Optional[int] = None
    if base.available and not base.ok:
        raise HTTPException(422, {"errors": ["Fix your resume first, it does not compile: " + (base.errors[0] if base.errors else "unknown error")], "log": base.log})
    if base.ok and base.pdf:
        try:
            base_pages = ats_service.extract_pdf_text(base.pdf)[1]
        except Exception:
            base_pages = None

    instructions = "; ".join(x for x in (opts.default_instructions.strip(), (extra or "").strip()) if x)
    prompt = _user_prompt(body, macros, jd, company, title, instructions, base_pages)
    data: dict = {}
    candidate, compiled, issues, notes = latex, None, [], []
    last_body = body
    for attempt in range(1, opts.max_attempts + 1):
        say("Tailoring your resume" if attempt == 1 else f"Fixing problems (attempt {attempt} of {opts.max_attempts})")
        reply = await text_chat(db, SYSTEM, prompt, temperature=opts.temperature if attempt == 1 else 0.1)
        out, raw_body = parse_reply(reply)
        new_body = _clean_body(raw_body)
        if not new_body.strip():
            issues = ["the response contained no body"]
            prompt = _repair_prompt(last_body, issues)
            continue
        new_body, fixes = texguard.autofix(new_body)
        notes = fixes
        cand = texguard.assemble(latex, new_body)
        rep = texguard.check_candidate(latex, cand, strict_terms=opts.strict_terms)
        issues = list(rep.blocking)
        say("Compiling the result")
        comp = await latex_service.compile_latex(cand)
        pages = None
        if comp.available and not comp.ok:
            issues += [f"LaTeX error: {e}" for e in comp.errors[:3]]
        elif comp.ok and comp.pdf:
            try:
                pages = ats_service.extract_pdf_text(comp.pdf)[1]
            except Exception:
                pages = None
            if base_pages and pages and pages > base_pages:
                issues.append(f"the result is {pages} pages but must fit on {base_pages}: trim the least relevant bullets")
        candidate, compiled, last_body = cand, comp, new_body
        data = {**data, **{k: v for k, v in out.items() if v}}
        if not issues:
            break
        prompt = _repair_prompt(new_body, issues)

    warnings: list[str] = []
    compile_ok = compiled.ok if compiled and compiled.available else None
    if issues:
        broke_tex = bool(compiled and compiled.available and not compiled.ok) or any(i.startswith(("missing", "unclosed", "\\")) for i in issues)
        if broke_tex:
            # Never hand the user broken TeX: keep their original and say why.
            return TailorResult(
                latex=latex, changes=[], matched_keywords=[], missing_keywords=_strs(data.get("missing_keywords")),
                estimated_fit=None, compile_ok=True if base.available else None, compile_errors=[],
                company=company, job_title=title, attempts=opts.max_attempts, pages=base_pages,
                warnings=["The AI could not produce valid LaTeX after " + str(opts.max_attempts) + " attempts, so your original was kept. Last problems: " + "; ".join(issues[:3])],
            )
        warnings = [f"Review before accepting: {i}" for i in issues]  # compiles fine, but facts need a human look
    if notes:
        warnings += [f"Auto-fixed: {n}" for n in notes]

    fit = data.get("estimated_fit")
    try:
        fit = int(float(fit)) if fit not in (None, "") else None
    except (TypeError, ValueError):
        fit = None
    fit = fit if fit and 1 <= fit <= 100 else None  # 0 or out of range is a placeholder, not an estimate
    return TailorResult(
        latex=candidate,
        changes=_strs(data.get("changes")),
        matched_keywords=_strs(data.get("matched_keywords")),
        missing_keywords=_strs(data.get("missing_keywords")),
        estimated_fit=fit,
        compile_ok=compile_ok,
        compile_errors=compiled.errors if compiled and compiled.available and not compiled.ok else [],
        company=company,
        job_title=title,
        warnings=warnings,
        attempts=attempt if opts.max_attempts else 1,
        pages=base_pages,
    )
