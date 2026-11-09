import os

# Must be set before the app is imported anywhere.
os.environ["DATABASE_URL"] = "sqlite:///./data/test.db"
os.environ["FAST_PASSWORD_HASH"] = "true"
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough-for-hs256"

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import ratelimit

PASSWORD = "correct horse battery staple"


def signup(c: TestClient, email: str | None = None, password: str = PASSWORD, name: str = "Test User"):
    email = email or f"user-{uuid.uuid4().hex[:10]}@example.com"
    r = c.post("/api/auth/signup", json={"email": email, "password": password, "name": name})
    assert r.status_code == 201, r.text
    return email, r.json()


@pytest.fixture()
def anon():
    """A client with no credentials."""
    ratelimit.clear_all()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def client():
    """A client signed in as a brand-new user. `client.user_id` and `client.email` identify them."""
    ratelimit.clear_all()
    with TestClient(app) as c:
        email, data = signup(c)
        c.headers["Authorization"] = f"Bearer {data['access_token']}"
        c.user_id, c.email = data["user"]["id"], email
        yield c


@pytest.fixture()
def make_user():
    """Make extra signed-in clients inside one test (for isolation checks)."""
    made = []

    def _make():
        c = TestClient(app)
        c.__enter__()
        email, data = signup(c)
        c.headers["Authorization"] = f"Bearer {data['access_token']}"
        c.user_id, c.email = data["user"]["id"], email
        made.append(c)
        return c

    ratelimit.clear_all()
    yield _make
    for c in made:
        c.__exit__(None, None, None)
