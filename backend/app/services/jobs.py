"""Fetch openings from public ATS job-board APIs (Greenhouse, Lever, Ashby) and keep early-career ones."""
import asyncio
import html
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Job
from . import cache, geo

COMPANIES_FILE = Path(__file__).parent.parent / "data" / "companies.json"

INTERN_RE = re.compile(r"\b(intern|internship|co-?op|apprentice(ship)?)\b", re.I)
NEW_GRAD_RE = re.compile(
    r"\b(new[\s-]?grad(uate)?s?|early[\s-]?career|university|campus|graduate|entry[\s-]?level|residen(t|cy)|fellow(ship)?)\b",
    re.I,
)
JUNIOR_RE = re.compile(r"\b(junior|jr\.?|associate|(engineer|developer|swe|sde)\s*[-–—,:]?\s*(i|1)|level\s*(1|i)|l3|ic1|ic2)\b", re.I)
SENIOR_RE = re.compile(
    r"\b(senior|sr\.?|staff|principal|lead|head of|director|vp|vice president|distinguished|architect|"
    r"engineering manager|(engineer|developer|swe|sde)\s*[-–—,:]?\s*(ii|iii|iv|v|2|3|4|5)|l[4-9]|ic[3-9]|manager,)\b",
    re.I,
)
# "Sales Engineer", "Technical Support Engineer"... match engineering keywords but aren't software roles.
NON_ENG_RE = re.compile(
    r"\b(sales|account (executive|manager)|recruit(er|ing)|marketing|customer (success|support)|technical (support|services|account)|"
    r"solutions? (engineer|architect|consultant)|support engineer|business development|legal|finance|payroll)\b",
    re.I,
)

# Only unmistakably entry-level phrasing. "1-3 years" / "1+ years" is mid-level and deliberately not matched.
LOW_EXPERIENCE_RE = re.compile(
    r"\b0\s*(-|–|to)\s*[12]\+?\s*years?\b|\b1\s*(-|–|to)\s*2\s*years?\b|\b(0|zero)\s*\+\s*years?\b"
    r"|\bno (prior |previous )?(professional |industry )?experience (is )?(required|necessary)\b"
    r"|\b(recent|new) (college )?graduates?\b",
    re.I,
)
HIGH_EXPERIENCE_RE = re.compile(r"\b([4-9]|1[0-9])\s*\+\s*years?\b", re.I)


def classify(title: str, description: str) -> str:
    """Return intern | new_grad | junior | other."""
    if SENIOR_RE.search(title):
        return "other"
    if INTERN_RE.search(title):
        return "intern"
    if NEW_GRAD_RE.search(title):
        return "new_grad"
    if JUNIOR_RE.search(title):
        return "junior"
    head = description[:4000]
    if LOW_EXPERIENCE_RE.search(head) and not HIGH_EXPERIENCE_RE.search(head):
        return "junior"
    return "other"


def strip_html(raw: str) -> str:
    text = html.unescape(raw or "")
    text = re.sub(r"<(script|style).*?</\1>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>|</p>|</li>|</h\d>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n\n", text)).strip()


def load_companies() -> list[dict]:
    return json.loads(COMPANIES_FILE.read_text())


@dataclass
class RawJob:
    source: str
    external_id: str
    company: str
    title: str
    location: str
    url: str
    description: str = ""
    posted_at: Optional[datetime] = None
    detail_url: Optional[str] = None  # fetched lazily for plausible matches only
    detail_kind: str = ""  # greenhouse | workday | microsoft | smartrecruiters
    level_hint: str = ""  # set when the source itself flags the role (e.g. Amazon "university" / intern)


@dataclass
class RefreshStatus:
    running: bool = False
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    boards_total: int = 0
    boards_done: int = 0
    boards_failed: list[str] = field(default_factory=list)
    found: int = 0
    added: int = 0
    error: Optional[str] = None


status = RefreshStatus()


def _parse_dt(value: object) -> Optional[datetime]:
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        if isinstance(value, str) and value:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return None


def careers_url(co: dict) -> str:
    ats, slug = co["ats"], co["slug"]
    if ats == "workday":
        t, wd, site = slug.split("|")
        return f"https://{t}.wd{wd}.myworkdayjobs.com/{site}"
    return {
        "greenhouse": f"https://boards.greenhouse.io/{slug}",
        "lever": f"https://jobs.lever.co/{slug}",
        "ashby": f"https://jobs.ashbyhq.com/{slug}",
        "smartrecruiters": f"https://jobs.smartrecruiters.com/{slug}",
        "amazon": "https://www.amazon.jobs",
        "microsoft": "https://apply.careers.microsoft.com",
        "eightfold": f"https://{slug.split('|')[0]}",
    }.get(ats, "")


def _queries(roles: list[str]) -> list[str]:
    return [r for r in roles if r.strip()][:3] or ["software engineer"]


def _relative_posted(text: str) -> Optional[datetime]:
    now = datetime.now(timezone.utc)
    t = (text or "").lower()
    if "today" in t:
        return now
    if "yesterday" in t:
        return now - timedelta(days=1)
    m = re.search(r"(\d+)\+?\s*day", t)
    return now - timedelta(days=int(m.group(1))) if m else None


async def _fetch_amazon(client: httpx.AsyncClient, co: dict, roles: list[str], locations: list[str]) -> list[RawJob]:
    city = next((w for w in locations if geo.country_code3(w)), None)
    out: dict[str, RawJob] = {}
    for q in _queries(roles):
        for offset in (0, 100):
            params: dict = {"base_query": q, "result_limit": 100, "offset": offset, "sort": "recent"}
            if city:
                params["country"] = geo.country_code3(city)
                params["normalized_city_name[]"] = geo.pretty(city)
            r = await client.get("https://www.amazon.jobs/en/search.json", params=params)
            r.raise_for_status()
            jobs = r.json().get("jobs", [])
            for j in jobs:
                try:
                    posted = datetime.strptime(" ".join(j.get("posted_date", "").split()), "%B %d, %Y").replace(tzinfo=timezone.utc)
                except ValueError:
                    posted = None
                desc = "\n\n".join(j.get(k) or "" for k in ("description", "basic_qualifications", "preferred_qualifications"))
                out[str(j["id"])] = RawJob(
                    "amazon", str(j["id"]), co["name"], j.get("title", ""), j.get("location", ""),
                    "https://www.amazon.jobs" + j.get("job_path", ""), description=strip_html(desc), posted_at=posted,
                    level_hint="intern" if j.get("is_intern") else ("new_grad" if j.get("university_job") else ""),
                )
            if len(jobs) < 100:
                break
    return list(out.values())


async def _fetch_microsoft(client: httpx.AsyncClient, co: dict, roles: list[str], locations: list[str]) -> list[RawJob]:
    loc = next((w for w in locations if w.lower() not in ("remote", "anywhere")), "")
    out: dict[str, RawJob] = {}
    for q in _queries(roles):
        for start in range(0, 60, 10):  # the API caps a page at 10 results
            r = await client.get(
                "https://apply.careers.microsoft.com/api/pcsx/search",
                params={"domain": "microsoft.com", "query": q, "location": geo.pretty(loc) if loc else "", "start": start, "num": 10},
            )
            r.raise_for_status()
            positions = (r.json().get("data") or {}).get("positions", [])
            for p in positions:
                pid = str(p["id"])
                locs = p.get("standardizedLocations") or p.get("locations") or []
                out[pid] = RawJob(
                    "microsoft", pid, co["name"], p.get("name", ""), "; ".join(locs),
                    "https://apply.careers.microsoft.com" + p.get("positionUrl", f"/careers/job/{pid}"),
                    posted_at=datetime.fromtimestamp(p["postedTs"], tz=timezone.utc) if p.get("postedTs") else None,
                    detail_url=f"https://apply.careers.microsoft.com/api/pcsx/position_details?position_id={pid}&domain=microsoft.com&hl=en",
                    detail_kind="microsoft",
                )
            if len(positions) < 10:
                break
    return list(out.values())


async def _fetch_workday(client: httpx.AsyncClient, co: dict, roles: list[str], locations: list[str]) -> list[RawJob]:
    tenant, wd, site = co["slug"].split("|")
    base = f"https://{tenant}.wd{wd}.myworkdayjobs.com"
    out: dict[str, RawJob] = {}
    for q in _queries(roles):
        for offset in (0, 20, 40):
            r = await client.post(
                f"{base}/wday/cxs/{tenant}/{site}/jobs",
                json={"limit": 20, "offset": offset, "searchText": q, "appliedFacets": {}},
            )
            r.raise_for_status()
            posts = r.json().get("jobPostings", [])
            for p in posts:
                path = p.get("externalPath", "")
                out[path] = RawJob(
                    "workday", f"{tenant}:{path}", co["name"], p.get("title", ""), p.get("locationsText", ""),
                    f"{base}/{site}{path}", posted_at=_relative_posted(p.get("postedOn", "")),
                    detail_url=f"{base}/wday/cxs/{tenant}/{site}{path}", detail_kind="workday",
                )
            if len(posts) < 20:
                break
    return list(out.values())


async def _fetch_smartrecruiters(client: httpx.AsyncClient, co: dict, roles: list[str], locations: list[str]) -> list[RawJob]:
    slug, out = co["slug"], []
    for offset in (0, 100, 200):
        r = await client.get(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings", params={"limit": 100, "offset": offset})
        r.raise_for_status()
        content = r.json().get("content", [])
        for p in content:
            loc = p.get("location") or {}
            place = ", ".join(x for x in (loc.get("city"), loc.get("region"), (loc.get("country") or "").upper()) if x)
            if loc.get("remote"):
                place = (place + " (Remote)").strip()
            out.append(RawJob(
                "smartrecruiters", str(p["id"]), co["name"], p.get("name", ""), place,
                f"https://jobs.smartrecruiters.com/{slug}/{p['id']}", posted_at=_parse_dt(p.get("releasedDate")),
                detail_url=f"https://api.smartrecruiters.com/v1/companies/{slug}/postings/{p['id']}", detail_kind="smartrecruiters",
            ))
        if len(content) < 100:
            break
    return out


async def _fetch_eightfold(client: httpx.AsyncClient, co: dict, roles: list[str], locations: list[str]) -> list[RawJob]:
    host, domain = co["slug"].split("|")
    out: dict[str, RawJob] = {}
    for q in _queries(roles):
        for start in (0, 10, 20):
            r = await client.get(f"https://{host}/api/apply/v2/jobs", params={"domain": domain, "start": start, "num": 10, "query": q})
            r.raise_for_status()
            positions = r.json().get("positions", [])
            for p in positions:
                pid = str(p["id"])
                out[pid] = RawJob(
                    "eightfold", pid, co["name"], p.get("name", ""), p.get("location", ""),
                    f"https://{host}/careers/job/{pid}",
                    posted_at=datetime.fromtimestamp(p["t_create"], tz=timezone.utc) if p.get("t_create") else None,
                )
            if len(positions) < 10:
                break
    return list(out.values())


async def _fetch_board(client: httpx.AsyncClient, co: dict, roles: list[str], locations: list[str]) -> list[RawJob]:
    ats, slug, name = co["ats"], co["slug"], co["name"]
    if ats == "amazon":
        return await _fetch_amazon(client, co, roles, locations)
    if ats == "microsoft":
        return await _fetch_microsoft(client, co, roles, locations)
    if ats == "workday":
        return await _fetch_workday(client, co, roles, locations)
    if ats == "smartrecruiters":
        return await _fetch_smartrecruiters(client, co, roles, locations)
    if ats == "eightfold":
        return await _fetch_eightfold(client, co, roles, locations)
    if ats == "greenhouse":
        r = await client.get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
        r.raise_for_status()
        return [
            RawJob(
                "greenhouse", str(j["id"]), name, j.get("title", ""),
                (j.get("location") or {}).get("name", ""), j.get("absolute_url", ""),
                posted_at=_parse_dt(j.get("updated_at")),
                detail_url=f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{j['id']}", detail_kind="greenhouse",
            )
            for j in r.json().get("jobs", [])
        ]
    if ats == "lever":
        r = await client.get(f"https://api.lever.co/v0/postings/{slug}", params={"mode": "json"})
        r.raise_for_status()
        return [
            RawJob(
                "lever", j["id"], name, j.get("text", ""),
                (j.get("categories") or {}).get("location", "") or "", j.get("hostedUrl", ""),
                description=j.get("descriptionPlain", "") or strip_html(j.get("description", "")),
                posted_at=_parse_dt(j.get("createdAt")),
            )
            for j in r.json()
        ]
    if ats == "ashby":
        r = await client.get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
        r.raise_for_status()
        return [
            RawJob(
                "ashby", j["id"], name, j.get("title", ""), j.get("location", "") or "",
                j.get("jobUrl", ""),
                description=j.get("descriptionPlain", "") or strip_html(j.get("descriptionHtml", "")),
                posted_at=_parse_dt(j.get("publishedAt")),
            )
            for j in r.json().get("jobs", [])
            if j.get("isListed", True)
        ]
    raise ValueError(f"unknown ats {ats}")


async def _fill_description(client: httpx.AsyncClient, j: RawJob) -> None:
    d = await client.get(j.detail_url)
    data = d.json()
    if j.detail_kind == "greenhouse":
        j.description = strip_html(data.get("content", ""))
    elif j.detail_kind == "microsoft":
        j.description = strip_html((data.get("data") or {}).get("jobDescription", ""))
    elif j.detail_kind == "workday":
        j.description = strip_html((data.get("jobPostingInfo") or {}).get("jobDescription", ""))
    elif j.detail_kind == "smartrecruiters":
        sections = ((data.get("jobAd") or {}).get("sections")) or {}
        j.description = strip_html("\n\n".join((v or {}).get("text", "") for v in sections.values() if isinstance(v, dict)))


def _title_matches(title: str, roles: list[str]) -> bool:
    if not roles:
        return True
    t = title.lower()
    return any(r.lower().strip() in t for r in roles if r.strip())


def _location_matches(location: str, wanted: list[str]) -> bool:
    return geo.location_matches(location, wanted)


async def refresh_jobs(
    session_factory,
    roles: list[str],
    locations: list[str],
    companies: list[str],
    include_internships: bool,
    include_all_levels: bool,
) -> None:
    global status
    status = RefreshStatus(running=True, started_at=datetime.now(timezone.utc).isoformat())
    try:
        boards = load_companies()
        if companies:
            wanted = {c.lower() for c in companies}
            boards = [b for b in boards if b["name"].lower() in wanted or b["slug"].lower() in wanted]
        status.boards_total = len(boards)
        sem = asyncio.Semaphore(10)
        headers = {"User-Agent": "hirepilot/1.0 (personal job search)"}

        async with httpx.AsyncClient(timeout=25, headers=headers, follow_redirects=True) as client:

            async def one(co: dict) -> list[RawJob]:
                async with sem:
                    try:
                        jobs = await _fetch_board(client, co, roles, locations)
                    except Exception:  # bad slug, 404, rate limit... skip the board, report it
                        status.boards_failed.append(co["name"])
                        return []
                    finally:
                        status.boards_done += 1
                    keep: list[RawJob] = []
                    for j in jobs:
                        if not _title_matches(j.title, roles) or not _location_matches(j.location, locations):
                            continue
                        if SENIOR_RE.search(j.title) and not include_all_levels:
                            continue
                        if NON_ENG_RE.search(j.title) and not include_all_levels:
                            continue
                        keep.append(j)
                    # Some boards list titles only. Fetch the description for plausible matches: titles that already
                    # read as early-career always; ambiguous ones up to a cap so "0-2 years" postings can be caught.
                    ambiguous_budget = 25
                    for j in keep:
                        if not j.detail_url or j.description:
                            continue
                        if not j.level_hint and classify(j.title, "") == "other":
                            if ambiguous_budget <= 0:
                                continue
                            ambiguous_budget -= 1
                        try:
                            await _fill_description(client, j)
                        except Exception:
                            pass
                    return keep

            batches = await asyncio.gather(*(one(c) for c in boards))

        raw = [j for b in batches for j in b]
        selected: list[tuple[RawJob, str]] = []
        for j in raw:
            tag = classify(j.title, j.description)
            if tag == "other" and j.level_hint and not SENIOR_RE.search(j.title):
                tag = j.level_hint
            if tag == "intern" and not include_internships:
                continue
            if tag == "other" and not include_all_levels:
                continue
            selected.append((j, tag))
        status.found = len(selected)

        db: Session = session_factory()
        try:
            for j, tag in selected:
                existing = db.scalar(select(Job).where(Job.source == j.source, Job.external_id == j.external_id))
                if existing:
                    existing.title, existing.location, existing.url = j.title, j.location, j.url
                    existing.level_tag = tag
                    if j.description:
                        existing.description = j.description
                else:
                    db.add(
                        Job(
                            source=j.source, external_id=j.external_id[:100], company=j.company, title=j.title,
                            location=j.location[:300], url=j.url[:1000], description=j.description[:20000],
                            posted_at=j.posted_at, level_tag=tag,
                        )
                    )
                    status.added += 1
            db.commit()
            cache.bump("catalog")
        finally:
            db.close()
    except Exception as e:  # pragma: no cover - defensive
        status.error = str(e)
    finally:
        status.running = False
        status.finished_at = datetime.now(timezone.utc).isoformat()
