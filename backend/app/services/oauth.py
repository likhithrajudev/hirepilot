"""OAuth 2.0 sign-in for Google, GitHub and Apple (authorization-code flow).

A provider is enabled when its credentials are configured. The browser is bound to the flow with a signed, short-lived
cookie holding the `state` (and a PKCE verifier for Google), so a forged callback cannot sign a victim into someone
else's account. Network calls go through `client()`, which tests replace with a fake provider.
"""
import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

import httpx
import jwt

from ..config import settings
from .security import AuthError

PROVIDERS = ("google", "github", "apple")
COOKIE = "hp_oauth"
STATE_TTL = 600


@dataclass
class ProviderProfile:
    subject: str
    email: Optional[str]
    email_verified: bool
    name: str = ""
    avatar_url: Optional[str] = None


def client() -> httpx.AsyncClient:  # replaced in tests
    return httpx.AsyncClient(timeout=15, headers={"Accept": "application/json", "User-Agent": "hirepilot"})


def enabled() -> dict[str, bool]:
    return {
        "google": bool(settings.google_client_id and settings.google_client_secret),
        "github": bool(settings.github_client_id and settings.github_client_secret),
        "apple": bool(settings.apple_client_id and settings.apple_team_id and settings.apple_key_id and settings.apple_private_key),
    }


def redirect_uri(provider: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/api/auth/oauth/{provider}/callback"


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    return verifier, base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def safe_next(path: Optional[str]) -> str:
    """Only same-site relative paths. An open redirect after login is a phishing gift."""
    if not path or not path.startswith("/") or path.startswith("//") or "\\" in path or "\n" in path or "\r" in path:
        return "/"
    return path


def start(provider: str, next_path: Optional[str]) -> tuple[str, str]:
    """Returns (authorize_url, signed cookie value)."""
    if provider not in PROVIDERS or not enabled()[provider]:
        raise AuthError(f"{provider.title()} sign-in is not configured on this server.", 404)
    state = secrets.token_urlsafe(32)
    verifier, challenge = _pkce()
    cookie = jwt.encode({"state": state, "verifier": verifier, "provider": provider, "next": safe_next(next_path),
                         "exp": int(time.time()) + STATE_TTL}, settings.secret_key, algorithm="HS256")
    ru = redirect_uri(provider)
    if provider == "google":
        q = {"client_id": settings.google_client_id, "redirect_uri": ru, "response_type": "code", "scope": "openid email profile", "state": state,
             "code_challenge": challenge, "code_challenge_method": "S256", "prompt": "select_account"}
        url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(q)
    elif provider == "github":
        q = {"client_id": settings.github_client_id, "redirect_uri": ru, "scope": "read:user user:email", "state": state, "allow_signup": "true"}
        url = "https://github.com/login/oauth/authorize?" + urlencode(q)
    else:
        q = {"client_id": settings.apple_client_id, "redirect_uri": ru, "response_type": "code", "response_mode": "form_post",
             "scope": "name email", "state": state}
        url = "https://appleid.apple.com/auth/authorize?" + urlencode(q)
    return url, cookie


def verify_state(provider: str, cookie: Optional[str], state: Optional[str]) -> dict:
    if not cookie or not state:
        raise AuthError("Sign-in expired. Please try again.", 400)
    try:
        data = jwt.decode(cookie, settings.secret_key, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise AuthError("Sign-in expired. Please try again.", 400)
    if data.get("provider") != provider or not secrets.compare_digest(str(data.get("state", "")), state):
        raise AuthError("Sign-in could not be verified. Please try again.", 400)
    return data


def _apple_secret() -> str:
    now = int(time.time())
    key = settings.apple_private_key.replace("\\n", "\n")
    return jwt.encode({"iss": settings.apple_team_id, "iat": now, "exp": now + 300, "aud": "https://appleid.apple.com", "sub": settings.apple_client_id},
                      key, algorithm="ES256", headers={"kid": settings.apple_key_id})


async def fetch_profile(provider: str, code: str, verifier: str, apple_user_json: Optional[dict] = None) -> ProviderProfile:
    ru = redirect_uri(provider)
    async with client() as c:
        try:
            if provider == "google":
                tok = await c.post("https://oauth2.googleapis.com/token", data={
                    "code": code, "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
                    "redirect_uri": ru, "grant_type": "authorization_code", "code_verifier": verifier})
                tok.raise_for_status()
                info = await c.get("https://openidconnect.googleapis.com/v1/userinfo", headers={"Authorization": f"Bearer {tok.json()['access_token']}"})
                info.raise_for_status()
                d = info.json()
                return ProviderProfile(str(d["sub"]), d.get("email"), bool(d.get("email_verified")), d.get("name", ""), d.get("picture"))
            if provider == "github":
                tok = await c.post("https://github.com/login/oauth/access_token", data={
                    "client_id": settings.github_client_id, "client_secret": settings.github_client_secret, "code": code, "redirect_uri": ru})
                tok.raise_for_status()
                access = tok.json().get("access_token")
                if not access:
                    raise AuthError("GitHub did not accept the sign-in. Please try again.", 400)
                h = {"Authorization": f"Bearer {access}", "X-GitHub-Api-Version": "2022-11-28"}
                me = (await c.get("https://api.github.com/user", headers=h))
                me.raise_for_status()
                emails = await c.get("https://api.github.com/user/emails", headers=h)
                email, verified = None, False
                if emails.status_code == 200:
                    rows = emails.json()
                    pick = next((e for e in rows if e.get("primary") and e.get("verified")), None) or next((e for e in rows if e.get("verified")), None)
                    if pick:
                        email, verified = pick["email"], True
                d = me.json()
                return ProviderProfile(str(d["id"]), email, verified, d.get("name") or d.get("login", ""), d.get("avatar_url"))
            # apple
            tok = await c.post("https://appleid.apple.com/auth/token", data={
                "client_id": settings.apple_client_id, "client_secret": _apple_secret(), "code": code, "grant_type": "authorization_code", "redirect_uri": ru})
            tok.raise_for_status()
            id_token = tok.json()["id_token"]
            keys = (await c.get("https://appleid.apple.com/auth/keys")).json()["keys"]
            kid = jwt.get_unverified_header(id_token).get("kid")
            jwk = next((k for k in keys if k.get("kid") == kid), None)
            if not jwk:
                raise AuthError("Apple sign-in could not be verified.", 400)
            claims = jwt.decode(id_token, jwt.PyJWK(jwk).key, algorithms=["RS256"], audience=settings.apple_client_id, issuer="https://appleid.apple.com")
            verified = str(claims.get("email_verified", "false")).lower() == "true"
            n = (apple_user_json or {}).get("name") or {}
            name = " ".join(x for x in (n.get("firstName"), n.get("lastName")) if x)
            return ProviderProfile(str(claims["sub"]), claims.get("email"), verified, name, None)
        except AuthError:
            raise
        except (httpx.HTTPError, KeyError, ValueError, jwt.InvalidTokenError):
            raise AuthError("Could not complete sign-in with the provider. Please try again.", 502)
