"""Guards for AI-edited LaTeX. The model may only change the document body; everything else is verified in code.

Why this exists: an LLM that rewrites a whole .tex file can silently change packages, break a custom environment,
leave a brace unclosed, write `40%` (a LaTeX comment that swallows the rest of the line, including closing braces),
or add skills/metrics that were never in the resume. Each check below catches one of those.
"""
import re
from dataclasses import dataclass, field
from typing import Optional

from .latex import find_unbalanced_brace

_BEGIN = r"\begin{document}"
_END = r"\end{document}"


def split_document(src: str) -> Optional[tuple[str, str, str]]:
    """(preamble, body, tail). preamble ends just before \\begin{document}; tail starts at \\end{document}."""
    a = src.find(_BEGIN)
    b = src.rfind(_END)
    if a == -1 or b == -1 or b < a:
        return None
    return src[:a], src[a + len(_BEGIN) : b], src[b:]


def assemble(original: str, new_body: str) -> str:
    """Original preamble and tail, byte for byte, around the model's body."""
    parts = split_document(original)
    assert parts, "original has no document body"
    pre, _, tail = parts
    return f"{pre}{_BEGIN}\n{new_body.strip(chr(10))}\n{tail}"


def custom_macros(preamble: str) -> list[str]:
    """Commands/environments the preamble defines, so the model uses them instead of inventing markup."""
    names = re.findall(r"\\(?:re)?newcommand\*?\{?\\([A-Za-z@]+)", preamble)
    names += re.findall(r"\\def\\([A-Za-z@]+)", preamble)
    envs = re.findall(r"\\(?:re)?newenvironment\*?\{([A-Za-z@*]+)\}", preamble)
    return [f"\\{n}" for n in dict.fromkeys(names)] + [f"environment {{{e}}}" for e in dict.fromkeys(envs)]


# ---------- lint ----------
_TABLE_ENVS = ("tabular", "tabularx", "array", "align", "align*", "matrix", "pmatrix", "tabu", "longtable")


def _strip_comments(s: str) -> str:
    return re.sub(r"(?<!\\)%.*", "", s)


def check_environments(body: str) -> list[str]:
    stack: list[tuple[str, int]] = []
    problems: list[str] = []
    for ln, line in enumerate(_strip_comments(body).split("\n"), 1):
        for m in re.finditer(r"\\(begin|end)\{([^}]+)\}", line):
            kind, name = m.groups()
            if kind == "begin":
                stack.append((name, ln))
            elif not stack:
                problems.append(f"\\end{{{name}}} on body line {ln} has no matching \\begin")
            elif stack[-1][0] != name:
                problems.append(f"\\end{{{name}}} on body line {ln} closes \\begin{{{stack[-1][0]}}} from line {stack[-1][1]}")
                stack.pop()
            else:
                stack.pop()
    problems += [f"\\begin{{{n}}} on body line {ln} is never closed" for n, ln in stack]
    return problems


_UNESCAPED_PERCENT = re.compile(r"(?<![\\%])(\d)%")


def autofix(body: str) -> tuple[str, list[str]]:
    """Safe, mechanical fixes only. Returns (body, notes)."""
    notes: list[str] = []
    fixed = _UNESCAPED_PERCENT.sub(r"\1\\%", body)
    if fixed != body:
        notes.append("escaped a bare % after a number (it would have commented out the rest of the line)")
    # "&" is only legal inside table-like environments; escape it elsewhere, line by line.
    out, depth = [], 0
    for line in fixed.split("\n"):
        depth += sum(len(re.findall(rf"\\begin\{{{re.escape(e)}\}}", line)) for e in _TABLE_ENVS)
        if depth <= 0 and "&" in line:
            line = re.sub(r"(?<![\\&])&", r"\\&", line)
        depth -= sum(len(re.findall(rf"\\end\{{{re.escape(e)}\}}", line)) for e in _TABLE_ENVS)
        out.append(line)
    body3 = "\n".join(out)
    if body3 != fixed:
        notes.append("escaped a stray & outside a table")
    return body3, notes


def lint(body: str) -> list[str]:
    issues = check_environments(body)
    hint = find_unbalanced_brace(body)
    if hint:
        issues.append(hint.replace("Likely cause: ", "").replace(" line ", " body line ", 1))
    if _UNESCAPED_PERCENT.search(body):
        issues.append("bare % after a number acts as a comment")
    return issues


# ---------- fact checks ----------
_NUM = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|M|%|x|\+))?(?![\w])")
_URLISH = re.compile(r"(https?://[^\s}\\]+|[\w.+-]+@[\w-]+\.[\w.-]+)")
_TERM = re.compile(r"\b[A-Za-z][A-Za-z0-9]*(?:[+#]{1,2}|\.[A-Za-z0-9]+)?\b")
_STOP = {w.lower() for w in """the and for with from that this into over under using used use built build led lead leading
designed design developed develop implemented implement improved improve reduced reduce increased increase delivered
deliver created create managed manage worked work focused focus responsible strong experience skills project projects
education summary professional technical backend frontend software engineer engineering developer development systems
system applications application services service data team teams cross functional collaborative scalable high quality
production performance reliable robust efficient maintainable testing tests test code review reviews agile scrum""".split()}


def visible_text(tex: str) -> str:
    t = _strip_comments(tex)
    t = re.sub(r"\\(?:href)\{[^}]*\}", "", t)
    t = re.sub(r"\\[A-Za-z@]+\*?", " ", t)
    return re.sub(r"[{}\\$&]", " ", t)


def numbers_in(tex: str) -> set[str]:
    return {re.sub(r"[\s,]", "", m.group(0)).lower() for m in _NUM.finditer(visible_text(tex))}


def contact_facts(tex: str) -> set[str]:
    return {m.group(0).rstrip(".,)").lower() for m in _URLISH.finditer(tex)}


def new_terms(original_body: str, new_body: str) -> list[str]:
    """Technology-looking words in the new text that never appear in the original (candidate invented a skill)."""
    old = {m.group(0).lower() for m in _TERM.finditer(visible_text(original_body))}
    found: dict[str, str] = {}
    for m in _TERM.finditer(visible_text(new_body)):
        w = m.group(0)
        lw = w.lower()
        if lw in old or lw in _STOP or len(w) < 3:
            continue
        if re.search(r"[A-Z].*[A-Z]|\d|[+#.]", w) or (w[0].isupper() and len(w) > 3):
            found.setdefault(lw, w)
    return sorted(found.values(), key=str.lower)


@dataclass
class GuardReport:
    blocking: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def check_candidate(original: str, candidate: str, strict_terms: bool = True) -> GuardReport:
    """Compare a tailored document with the original. `blocking` items must be fixed or the result discarded."""
    rep = GuardReport()
    o, c = split_document(original), split_document(candidate)
    if not o or not c:
        rep.blocking.append("missing \\begin{document} / \\end{document}")
        return rep
    if o[0] != c[0]:
        rep.blocking.append("the preamble (packages, macros, layout) was modified")
    rep.blocking += lint(c[1])
    lost = contact_facts(original) - contact_facts(candidate)
    if lost:
        rep.blocking.append("contact details or links were dropped: " + ", ".join(sorted(lost)[:4]))
    added_nums = numbers_in(c[1]) - numbers_in(o[1])
    if added_nums:
        rep.blocking.append("numbers/metrics that are not in the original resume: " + ", ".join(sorted(added_nums)[:6]))
    terms = new_terms(o[1], c[1])
    if terms:
        (rep.blocking if strict_terms else rep.warnings).append("skills/terms not found in the original resume: " + ", ".join(terms[:8]))
    return rep
