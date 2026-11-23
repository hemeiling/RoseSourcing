"""Google sign-in: redirect, CSRF/nonce checks, account creation and linking (Google is mocked)."""

from __future__ import annotations

import time
from urllib.parse import parse_qs, urlparse

import httpx2
import jwt
import pytest

from app.api import auth as auth_mod
from app.config import get_settings


@pytest.fixture
def google(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "test-client.apps.googleusercontent.com")
    monkeypatch.setattr(s, "google_client_secret", "test-secret")
    monkeypatch.setattr(s, "public_base_url", "http://testserver")
    state = {"claims": {}}

    class FakeResp:
        status_code = 200

        def json(self):
            return {"id_token": jwt.encode(state["claims"], "unused-google-key", algorithm="HS256")}

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, data):
            assert url == auth_mod.GOOGLE_TOKEN_URL and data["code_verifier"]
            state["posted"] = data
            return FakeResp()

    class FakeHttpx:
        Client = FakeClient
        HTTPError = httpx2.HTTPError

    monkeypatch.setattr(auth_mod, "httpx2", FakeHttpx)
    return state


def _start(client, nxt="/channels"):
    r = client.get(f"/api/auth/google/login?next={nxt}", follow_redirects=False)
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    flow = jwt.decode(client.cookies.get(auth_mod.OAUTH_COOKIE), get_settings().secret_key, algorithms=["HS256"])
    return q, flow


def _claims(flow, email="founder@gmail.com", sub="google-sub-1", verified=True):
    return {"iss": "https://accounts.google.com", "aud": "test-client.apps.googleusercontent.com", "sub": sub, "email": email,
            "email_verified": verified, "nonce": flow["nonce"], "exp": int(time.time()) + 300, "name": "Founder"}


def test_not_configured_redirects_with_message(client):
    r = client.get("/api/auth/google/login", follow_redirects=False)
    assert r.status_code == 302 and "/login?error=" in r.headers["location"]
    assert client.get("/api/auth/signup-status").json()["google_enabled"] is False


def test_redirect_uses_pkce_state_and_nonce(client, google):
    q, flow = _start(client)
    assert q["redirect_uri"] == ["http://testserver/api/auth/google/callback"]
    assert q["code_challenge_method"] == ["S256"] and q["state"] == [flow["state"]] and q["nonce"] == [flow["nonce"]]
    assert flow["next"] == "/channels"
    assert client.get("/api/auth/signup-status").json()["google_enabled"] is True


def test_forged_state_is_rejected(client, google):
    _start(client)
    r = client.get("/api/auth/google/callback?code=abc&state=forged", follow_redirects=False)
    assert "/login?error=" in r.headers["location"]
    assert client.get("/api/auth/me").status_code == 401


def test_first_google_user_becomes_owner(client, google):
    _, flow = _start(client)
    google["claims"] = _claims(flow)
    r = client.get(f"/api/auth/google/callback?code=abc&state={flow['state']}", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "http://testserver/channels"
    me = client.get("/api/auth/me").json()
    assert me["email"] == "founder@gmail.com" and me["role"] == "owner"
    # Google-only accounts cannot use password login.
    client.post("/api/auth/logout")
    assert "Google" in client.post("/api/auth/login", json={"email": "founder@gmail.com", "password": "whatever1"}).json()["detail"]


def test_unverified_email_rejected(client, google):
    _, flow = _start(client)
    google["claims"] = _claims(flow, verified=False)
    r = client.get(f"/api/auth/google/callback?code=abc&state={flow['state']}", follow_redirects=False)
    assert "/login?error=" in r.headers["location"]


def test_links_existing_password_account_and_closed_signup(client, google):
    client.post("/api/auth/signup", json={"email": "founder@gmail.com", "password": "password123"})
    client.post("/api/auth/logout")
    _, flow = _start(client)
    google["claims"] = _claims(flow)
    client.get(f"/api/auth/google/callback?code=abc&state={flow['state']}", follow_redirects=False)
    assert client.get("/api/auth/me").json()["role"] == "owner"
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"email": "founder@gmail.com", "password": "password123"}).status_code == 200
    client.post("/api/auth/logout")
    # A different Google account cannot sign up once the workspace has an owner.
    _, flow = _start(client)
    google["claims"] = _claims(flow, email="stranger@gmail.com", sub="google-sub-2")
    r = client.get(f"/api/auth/google/callback?code=abc&state={flow['state']}", follow_redirects=False)
    assert "Sign-ups%20are%20closed" in r.headers["location"]
