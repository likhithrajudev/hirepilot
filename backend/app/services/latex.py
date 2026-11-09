"""Compile LaTeX to PDF with pdflatex in a throwaway directory."""
import asyncio
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Optional

from ..config import settings


def latex_available() -> bool:
    return shutil.which("pdflatex") is not None


@dataclass
class CompileResult:
    ok: bool
    pdf: Optional[bytes] = None
    log: str = ""
    errors: list[str] = field(default_factory=list)
    available: bool = True


def _extract_errors(log: str) -> list[str]:
    errors: list[str] = []
    lines = log.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("!"):
            ctx = next((l for l in lines[i + 1 : i + 6] if l.startswith("l.")), "")
            errors.append(f"{line[1:].strip()} ({ctx.strip()})" if ctx else line[1:].strip())
    return errors[:10]


def find_unbalanced_brace(source: str) -> Optional[str]:
    """Point at the line of an unclosed '{' (or stray '}'). LaTeX itself only says "File ended" with no location.

    Skips comments and escaped characters. Verbatim-style content can fool it, so it is only used as a hint
    after a compile has already failed.
    """
    stack: list[tuple[int, str]] = []
    for ln, line in enumerate(source.split("\n"), 1):
        i = 0
        while i < len(line):
            c = line[i]
            if c == "%":
                break
            if c == "\\":
                i += 2
                continue
            if c == "{":
                stack.append((ln, line.strip()[:70]))
            elif c == "}":
                if not stack:
                    return f"Likely cause: stray closing brace '}}' on line {ln}: {line.strip()[:70]}"
                stack.pop()
            i += 1
    if stack:
        ln, text = stack[-1]
        return f"Likely cause: unclosed '{{' on line {ln}: {text}  (it is never closed before the end of the file)"
    return None


def _run(source: str) -> CompileResult:
    if not latex_available():
        return CompileResult(
            ok=False,
            available=False,
            errors=["pdflatex is not installed on the server (it is bundled in the Docker image)."],
        )
    # Paranoid file access: no reading/writing outside the working dir. Shell escape is off by default.
    env = {**os.environ, "openin_any": "p", "openout_any": "p", "TEXMFOUTPUT": ""}
    with tempfile.TemporaryDirectory(prefix="tex_") as tmp:
        with open(os.path.join(tmp, "main.tex"), "w", encoding="utf-8") as f:
            f.write(source)
        log = ""
        for _ in range(2):  # second pass resolves references
            try:
                proc = subprocess.run(
                    ["pdflatex", "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "main.tex"],
                    cwd=tmp,
                    env=env,
                    capture_output=True,
                    timeout=settings.latex_timeout,
                    stdin=subprocess.DEVNULL,
                )
            except subprocess.TimeoutExpired:
                return CompileResult(ok=False, errors=[f"Compilation timed out after {settings.latex_timeout}s."])
            log = proc.stdout.decode("utf-8", errors="replace")
            if proc.returncode != 0:
                errors = _extract_errors(log) or ["Compilation failed."]
                hint = find_unbalanced_brace(source)
                if hint:
                    errors.insert(0, hint)
                return CompileResult(ok=False, log=log[-8000:], errors=errors)
            if not re.search(r"Rerun to get|Label\(s\) may have changed", log):
                break
        pdf_path = os.path.join(tmp, "main.pdf")
        if not os.path.exists(pdf_path):
            return CompileResult(ok=False, log=log[-8000:], errors=["No PDF was produced."])
        with open(pdf_path, "rb") as f:
            return CompileResult(ok=True, pdf=f.read(), log=log[-8000:])


async def compile_latex(source: str) -> CompileResult:
    return await asyncio.to_thread(_run, source)


def latex_to_text(source: str) -> str:
    """Very rough LaTeX -> plain text, good enough to feed into relevance scoring."""
    body = source.split("\\begin{document}", 1)[-1]
    body = re.sub(r"(?m)(?<!\\)%.*$", "", body)
    body = re.sub(r"\\(?:href|url)\{[^}]*\}", "", body)
    body = re.sub(r"\\[a-zA-Z]+\*?(\[[^\]]*\])?", " ", body)
    body = re.sub(r"[{}\\$&^_~]", " ", body)
    return re.sub(r"\s+", " ", body).strip()
