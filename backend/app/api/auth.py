from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import time
from urllib.parse import quote, urlencode

import httpx2
import jwt
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select

from .. import audit
from ..config import get_settings
from ..models import User
from ..schemas import LoginIn, SignupIn, UserOut
from ..security import COOKIE_NAME, create_access_token, hash_password, verify_password
from .deps import DB, CurrentUser

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
OAUTH_COOKIE = "aicos_oauth"


def _set_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        secure=s.is_production,
        samesite="lax",
        max_age=s.access_token_ttl_hours * 3600,
        path="/",
    )


def _signup_open(db, email: str | None = None) -> bool:
    s = get_settings()
    if db.scalar(select(func.count(User.id))) == 0:
        return True
    if s.signup_enabled:
        return True
    return bool(email and email.lower() in s.allowed_signup_email_set)


@router.get("/signup-status")
def signup_status(db: DB) -> dict:
    first = db.scalar(select(func.count(User.id))) == 0
    s = get_settings()
    return {"signup_open": _signup_open(db), "first_user": first, "invite_list": bool(s.allowed_signup_email_set),
            "google_enabled": s.google_enabled}


@router.post("/signup", response_model=UserOut)
def signup(body: SignupIn, response: Response, db: DB) -> User:
    email = body.email.lower()
    if not _signup_open(db, email):
        raise HTTPException(403, "Sign-ups are closed. Ask the workspace owner to add your email to ALLOWED_SIGNUP_EMAILS.")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists.")
    is_first = db.scalar(select(func.count(User.id))) == 0
    user = User(email=email, password_hash=hash_password(body.password), display_name=body.display_name,
                role="owner" if is_first else "member")
    db.add(user)
    db.flush()
    audit.record(db, "user.signup", user_id=user.id, entity_type="user", entity_id=user.id)
    db.commit()
    _set_cookie(response, create_access_token(user.id))
    return user


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: DB) -> User:
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user and user.password_hash is None:
        raise HTTPException(401, "This account signs in with Google. Use 'Continue with Google'.")
    if not user or not verify_password(body.password, user.password_hash) or not user.is_active:
        raise HTTPException(401, "Incorrect email or password.")
    _set_cookie(response, create_access_token(user.id))
    return user


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


# ----------------------------------------------------------------------------- Google sign-in


def _base_url(request: Request) -> str:
    s = get_settings()
    return (s.public_base_url or s.render_external_url or str(request.base_url)).rstrip("/")


def _redirect_uri(request: Request) -> str:
    return f"{_base_url(request)}/api/auth/google/callback"


def _safe_next(path: str | None) -> str:
    # Only same-site relative paths, never "//host" or absolute URLs.
    return path if path and path.startswith("/") and not path.startswith("//") else "/dashboard"


def _login_error(request: Request, message: str) -> RedirectResponse:
    resp = RedirectResponse(f"{_base_url(request)}/login?error={quote(message)}", status_code=302)
    resp.delete_cookie(OAUTH_COOKIE, path="/api/auth/google")
    return resp


@router.get("/google/login")
def google_login(request: Request, next: str | None = None) -> RedirectResponse:
    s = get_settings()
    if not s.google_enabled:
        return _login_error(request, "Google sign-in is not configured on this server.")
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    params = {
        "client_id": s.google_client_id, "redirect_uri": _redirect_uri(request), "response_type": "code",
        "scope": "openid email profile", "state": state, "nonce": nonce, "code_challenge": challenge,
        "code_challenge_method": "S256", "prompt": "select_account",
    }
    # Short-lived signed cookie binds the callback to this browser (CSRF + PKCE + nonce).
    flow = jwt.encode({"state": state, "nonce": nonce, "verifier": verifier, "next": _safe_next(next), "exp": int(time.time()) + 600},
                      s.secret_key, algorithm="HS256")
    resp = RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=302)
    resp.set_cookie(OAUTH_COOKIE, flow, max_age=600, httponly=True, secure=s.is_production, samesite="lax", path="/api/auth/google")
    return resp


def _verify_id_token(id_token: str, client_id: str, nonce: str) -> dict:
    # The token comes straight from Google's token endpoint over TLS, which OpenID Connect accepts in place of
    # signature verification; the issuer, audience, expiry and nonce are still checked.
    claims = jwt.decode(id_token, options={"verify_signature": False})
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise ValueError("unexpected issuer")
    if claims.get("aud") != client_id:
        raise ValueError("token was issued for a different client")
    if int(claims.get("exp", 0)) < time.time():
        raise ValueError("token expired")
    if claims.get("nonce") != nonce:
        raise ValueError("nonce mismatch")
    if not claims.get("email") or claims.get("email_verified") not in (True, "true"):
        raise ValueError("Google did not confirm this email address")
    return claims


@router.get("/google/callback")
def google_callback(request: Request, db: DB, code: str | None = None, state: str | None = None, error: str | None = None) -> RedirectResponse:
    s = get_settings()
    if error:
        return _login_error(request, "Google sign-in was cancelled." if error == "access_denied" else f"Google sign-in failed: {error}")
    raw = request.cookies.get(OAUTH_COOKIE)
    try:
        flow = jwt.decode(raw or "", s.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return _login_error(request, "Sign-in session expired. Please try again.")
    if not code or not state or not secrets.compare_digest(state, flow["state"]):
        return _login_error(request, "Sign-in could not be verified. Please try again.")
    try:
        with httpx2.Client(timeout=15) as http:
            r = http.post(GOOGLE_TOKEN_URL, data={
                "code": code, "client_id": s.google_client_id, "client_secret": s.google_client_secret,
                "redirect_uri": _redirect_uri(request), "grant_type": "authorization_code", "code_verifier": flow["verifier"],
            })
        if r.status_code != 200:
            log.warning("Google token exchange failed: %s %s", r.status_code, r.text[:300])
            return _login_error(request, "Google sign-in failed while exchanging the code. Check the OAuth client settings.")
        claims = _verify_id_token(r.json().get("id_token", ""), s.google_client_id, flow["nonce"])
    except (httpx2.HTTPError, ValueError, jwt.PyJWTError) as e:
        log.warning("Google sign-in rejected: %s", e)
        return _login_error(request, f"Google sign-in could not be verified ({e}).")

    email, sub = claims["email"].lower(), claims["sub"]
    user = db.scalar(select(User).where(User.google_sub == sub)) or db.scalar(select(User).where(User.email == email))
    if user is None:
        if not _signup_open(db, email):
            return _login_error(request, "Sign-ups are closed. Ask the workspace owner to add your email to ALLOWED_SIGNUP_EMAILS.")
        is_first = db.scalar(select(func.count(User.id))) == 0
        user = User(email=email, password_hash=None, google_sub=sub, display_name=claims.get("name"),
                    role="owner" if is_first else "member")
        db.add(user)
        db.flush()
        audit.record(db, "user.signup", user_id=user.id, entity_type="user", entity_id=user.id, details={"method": "google"})
    elif not user.is_active:
        return _login_error(request, "This account is disabled.")
    elif user.google_sub is None:
        user.google_sub = sub  # same verified email: link the existing account to Google
        audit.record(db, "user.google_linked", user_id=user.id, entity_type="user", entity_id=user.id)
    db.commit()

    resp = RedirectResponse(f"{_base_url(request)}{flow['next']}", status_code=302)
    _set_cookie(resp, create_access_token(user.id))
    resp.delete_cookie(OAUTH_COOKIE, path="/api/auth/google")
    return resp
