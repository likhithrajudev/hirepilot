"""The plan catalog: the single source of truth for prices, limits and features.

The app enforces these limits, the billing API serves them, and the marketing site reads a generated copy
(`python -m app.services.plans > ../frontend/lib/plans.generated.json`). A test fails if the copy drifts.
"""
import json
from dataclasses import dataclass, field
from typing import Optional

# What is metered. "total" limits cap how many you can hold; "month" limits reset on the 1st (UTC).
METERED = {
    "resumes": {"label": "Resumes", "period": "total", "unit": "resumes"},
    "tailor": {"label": "AI resume tailoring", "period": "month", "unit": "tailors"},
    "ats_check": {"label": "ATS checks", "period": "month", "unit": "checks"},
    "review": {"label": "Hiring-manager role reviews", "period": "month", "unit": "reviews"},
    "apply_kit": {"label": "Application kits", "period": "month", "unit": "kits"},
    "scans": {"label": "Job scans", "period": "month", "unit": "scans"},
    "interview": {"label": "Interview credits", "period": "month", "unit": "credits"},
}
# What one interview costs, in credits. Voice costs more than text because the speech service is paid per word; coding includes the editor and test runs.
INTERVIEW_COST = {"text": 1, "voice": 2, "coding": 2}
AI_FEATURES = ("tailor", "ats_check", "review", "apply_kit", "interview")  # not metered when the user brings their own OpenAI key
ALL_TEMPLATES = ("classic", "modern", "compact", "academic", "minimal")


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    tagline: str
    audience: str
    prices: dict  # currency -> {"month": int, "year": int} in whole units; None = contact sales
    limits: dict  # feature -> int, or None for unlimited
    templates: tuple
    seats: Optional[int]
    support: str
    rank: int
    contact_sales: bool = False
    recommended: bool = False
    highlights: tuple = field(default_factory=tuple)


PLANS: tuple[Plan, ...] = (
    Plan("cadet", "Cadet", "Start your search", "Try everything with generous limits", {"USD": {"month": 0, "year": 0}, "INR": {"month": 0, "year": 0}},
         {"resumes": 1, "tailor": 3, "ats_check": 5, "review": 10, "apply_kit": 3, "scans": 5, "interview": 2}, ("classic", "minimal"), 1, "Community", 0,
         highlights=("1 resume with 2 ATS-safe templates", "Scan 250+ company career sites", "2 interview credits a month: 1 voice or 2 text interviews", "A feedback report with every interview", "Bring your own OpenAI key for unlimited AI")),
    Plan("pilot", "Pilot", "For an active search", "Students and new graduates applying widely", {"USD": {"month": 12, "year": 120}, "INR": {"month": 199, "year": 1990}},
         {"resumes": 5, "tailor": 40, "ats_check": 60, "review": 150, "apply_kit": 30, "scans": 60, "interview": 12}, ALL_TEMPLATES, 1, "Email", 1,
         highlights=("AI included, no API key needed", "All 5 ATS-safe templates", "Role reviews written like a hiring manager's", "12 interview credits a month: up to 6 voice or 12 text interviews", "Answer-by-answer feedback and a practice plan")),
    Plan("captain", "Captain", "Go all in", "Anyone running a serious, multi-company search", {"USD": {"month": 29, "year": 290}, "INR": {"month": 499, "year": 4990}},
         {"resumes": 25, "tailor": 200, "ats_check": 300, "review": 600, "apply_kit": 150, "scans": None, "interview": 60}, ALL_TEMPLATES, 1, "Priority email", 2, recommended=True,
         highlights=("5x the AI of Pilot", "Unlimited job scans", "60 interview credits a month: up to 30 voice or 60 text interviews", "Monitored sessions with an integrity report", "Saved code and test evidence in reports")),
    Plan("fleet", "Fleet", "For teams and programs", "Universities, bootcamps and career coaches", {"USD": {"month": None, "year": None}, "INR": {"month": None, "year": None}},
         {k: None for k in METERED}, ALL_TEMPLATES, None, "Dedicated", 3, contact_sales=True,
         highlights=("Unlimited interview credits", "Seats for your whole cohort", "Admin console and usage reporting", "Single sign-on and invoicing")),
)
BY_ID = {p.id: p for p in PLANS}

# Shown on the sales page as "Coming soon". Never presented as available.
ROADMAP = (
    {"key": "apply_forms", "label": "Application form scanner and autofill", "plans": ["captain", "fleet"]},
    {"key": "alerts", "label": "Email alerts for new matching roles", "plans": ["pilot", "captain", "fleet"]},
    {"key": "design", "label": "System design and low-level design tracks", "plans": ["captain", "fleet"]},
)


def get(plan_id: str) -> Plan:
    return BY_ID.get(plan_id, BY_ID["cadet"])


_UPGRADE = {"cadet": "pilot", "pilot": "captain"}


def next_plan(plan_id: str) -> Optional[str]:
    """The plan to suggest when someone hits a limit. Captain and Fleet have nothing above them to self-serve."""
    return _UPGRADE.get(plan_id)


def as_json() -> dict:
    return {
        "metered": [{"key": k, **v} for k, v in METERED.items()],
        "interview_costs": INTERVIEW_COST,
        "roadmap": list(ROADMAP),
        "plans": [{"id": p.id, "name": p.name, "tagline": p.tagline, "audience": p.audience, "prices": p.prices, "limits": p.limits, "templates": list(p.templates),
                   "seats": p.seats, "support": p.support, "rank": p.rank, "contact_sales": p.contact_sales, "recommended": p.recommended,
                   "highlights": list(p.highlights)} for p in PLANS],
    }


if __name__ == "__main__":
    print(json.dumps(as_json(), indent=2))
