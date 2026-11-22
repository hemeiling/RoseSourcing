from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import func, select

from .. import audit
from ..config import get_settings
from ..models import User
from ..schemas import LoginIn, SignupIn, UserOut
from ..security import COOKIE_NAME, create_access_token, hash_password, verify_password
from .deps import DB, CurrentUser

router = APIRouter(prefix="/api/auth", tags=["auth"])


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
    return {"signup_open": _signup_open(db), "first_user": first, "invite_list": bool(get_settings().allowed_signup_email_set)}


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
