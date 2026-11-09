"""City aliases and location matching, so "Bengaluru" finds "Bangalore, Karnataka, India" and "IN, KA, Bengaluru"."""
import re

# Each group is one place under its common spellings. The first entry is the canonical display name.
_GROUPS: list[tuple[str, ...]] = [
    ("bengaluru", "bangalore", "bengalooru", "blr"),
    ("mumbai", "bombay"),
    ("delhi", "new delhi", "ncr", "delhi ncr"),
    ("gurugram", "gurgaon"),
    ("noida",),
    ("hyderabad",),
    ("chennai", "madras"),
    ("pune",),
    ("kolkata", "calcutta"),
    ("ahmedabad",),
    ("new york", "new york city", "nyc", "manhattan", "brooklyn"),
    ("san francisco", "sf", "bay area", "san francisco bay area"),
    ("san jose", "santa clara", "sunnyvale", "mountain view", "palo alto", "menlo park", "cupertino", "redwood city"),
    ("seattle", "bellevue", "redmond"),
    ("los angeles", "la", "santa monica", "culver city"),
    ("austin",),
    ("boston", "cambridge ma"),
    ("chicago",),
    ("washington dc", "washington, dc", "arlington va"),
    ("atlanta",),
    ("denver", "boulder"),
    ("toronto",),
    ("vancouver",),
    ("london",),
    ("dublin",),
    ("berlin",),
    ("amsterdam",),
    ("paris",),
    ("zurich",),
    ("singapore",),
    ("tokyo",),
    ("sydney",),
    ("tel aviv",),
    ("dubai",),
]

_CITY_COUNTRY = {  # ISO-3 code used by Amazon's search API
    "bengaluru": "IND", "mumbai": "IND", "delhi": "IND", "gurugram": "IND", "noida": "IND", "hyderabad": "IND",
    "chennai": "IND", "pune": "IND", "kolkata": "IND", "ahmedabad": "IND",
    "new york": "USA", "san francisco": "USA", "san jose": "USA", "seattle": "USA", "los angeles": "USA",
    "austin": "USA", "boston": "USA", "chicago": "USA", "washington dc": "USA", "atlanta": "USA", "denver": "USA",
    "toronto": "CAN", "vancouver": "CAN", "london": "GBR", "dublin": "IRL", "berlin": "DEU", "amsterdam": "NLD",
    "paris": "FRA", "zurich": "CHE", "singapore": "SGP", "tokyo": "JPN", "sydney": "AUS", "tel aviv": "ISR",
    "dubai": "ARE",
}
# Country names and the 2-letter codes some APIs use ("IN, KA, Bengaluru").
_COUNTRIES = {"india": "IN", "united states": "US", "usa": "US", "us": "US", "united kingdom": "GB", "uk": "GB",
              "canada": "CA", "germany": "DE", "ireland": "IE", "singapore": "SG", "australia": "AU", "japan": "JP"}

_BY_ALIAS = {a: g for g in _GROUPS for a in g}


def canonical(term: str) -> str:
    t = term.strip().lower()
    return _BY_ALIAS[t][0] if t in _BY_ALIAS else t


def aliases(term: str) -> tuple[str, ...]:
    t = term.strip().lower()
    return _BY_ALIAS.get(t, (t,))


def country_code3(term: str) -> str | None:
    return _CITY_COUNTRY.get(canonical(term))


def pretty(term: str) -> str:
    return canonical(term).title()


def location_matches(location: str, wanted: list[str]) -> bool:
    wanted = [w for w in wanted if w.strip()]
    if not wanted:
        return True
    loc = location.lower()
    for w in wanted:
        wl = w.strip().lower()
        if wl in ("anywhere", "any", "global", "worldwide"):
            return True
        if wl == "remote":
            if "remote" in loc or "anywhere" in loc:
                return True
            continue
        if wl in _COUNTRIES:
            code = _COUNTRIES[wl]
            if wl in loc or re.search(rf"(^|[,\s]){code}([,\s]|$)", location):
                return True
            continue
        for a in aliases(wl):
            if re.search(rf"(?<![a-z]){re.escape(a)}(?![a-z])", loc):
                return True
    return False
