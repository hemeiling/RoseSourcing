"""Connector gateway: registry of external platforms plus an encrypted credential vault.

Credentials entered in Settings are encrypted with a key derived from SECRET_KEY and never
returned to the browser (only the last 4 characters). Environment variables still work and
are used when no credential is saved in the app.

"active" connectors have working adapters. Gateway connectors (WeChat, Alibaba, 1688,
Xiaohongshu, TikTok Shop, Amazon SP-API, Shopify, Keepa) can store credentials now; their data
adapters are planned and the UI says so - nothing is fetched from them yet.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx2
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import session_scope
from ..models import IntegrationCredential


@dataclass(frozen=True)
class Field:
    name: str
    label: str
    secret: bool = True
    env: str | None = None


@dataclass(frozen=True)
class Connector:
    key: str
    name: str
    group: str  # research | demand | marketplaces | social | sourcing | commerce
    active: bool
    provides: str
    requirements: str
    cost: str
    setup_url: str | None
    fields: tuple[Field, ...] = field(default_factory=tuple)
    login_note: str | None = None


CONNECTORS: tuple[Connector, ...] = (
    Connector(
        "claude_web_search", "Claude web search", "research", True,
        "Live web search with citations for every research step (market, customers, competitors, sourcing, channels).",
        "Uses the server's ANTHROPIC_API_KEY. Web search must be enabled for your organization in the Anthropic Console.",
        "Billed per search on your Anthropic account (estimated in AI usage).",
        "https://console.anthropic.com/", (),
        "No extra sign-in.",
    ),
    Connector(
        "serpapi", "SerpApi - Google Trends, Google Shopping, Amazon search", "demand", True,
        "Google Trends interest over time, Google Shopping listings and prices, and Amazon search results with ratings counts "
        "and 'bought in past month' badges - used to measure product popularity.",
        "Create a SerpApi account and copy your API key from the dashboard.",
        "Free plan: 250 searches/month; paid plans for more (check serpapi.com/pricing).",
        "https://serpapi.com/manage-api-key",
        (Field("api_key", "API key", True, "SERPAPI_API_KEY"),),
        "No Google or Amazon login needed - SerpApi returns public results through its own API.",
    ),
    Connector(
        "tavily", "Tavily Search API", "research", True,
        "Alternative web search provider for research steps.", "Create a Tavily account and copy the API key.",
        "Free tier available; check tavily.com pricing.", "https://app.tavily.com/",
        (Field("api_key", "API key", True, "TAVILY_API_KEY"),),
    ),
    Connector(
        "brave", "Brave Search API", "research", True,
        "Alternative web search provider for research steps.", "Create a Brave Search API subscription and copy the key.",
        "Free and paid plans; check brave.com/search/api.", "https://api-dashboard.search.brave.com/",
        (Field("api_key", "API key", True, "BRAVE_SEARCH_API_KEY"),),
    ),
    Connector(
        "amazon_sp_api", "Amazon Selling Partner API", "marketplaces", False,
        "Your own Amazon catalog, sales ranks, orders and fees once you sell on Amazon.",
        "An Amazon seller account (Professional plan), a registered SP-API developer profile, and a self-authorized app "
        "(LWA client ID/secret and refresh token).",
        "Free API; Amazon seller fees apply.", "https://developer-docs.amazon.com/sp-api/",
        (Field("lwa_client_id", "LWA client ID", False), Field("lwa_client_secret", "LWA client secret"),
         Field("refresh_token", "Refresh token"), Field("marketplace_id", "Marketplace ID", False)),
        "Requires your Amazon Seller Central login to authorize the app.",
    ),
    Connector(
        "tiktok_shop", "TikTok Shop Partner API", "social", False,
        "Shop products, orders and creator/affiliate data for TikTok Shop.",
        "A TikTok Shop seller account and an app created in TikTok Shop Partner Center.",
        "Free API; TikTok Shop fees apply.", "https://partner.tiktokshop.com/",
        (Field("app_key", "App key", False), Field("app_secret", "App secret"), Field("access_token", "Access token")),
        "Requires your TikTok Shop seller login to authorize the app.",
    ),
    Connector(
        "xiaohongshu", "Xiaohongshu (RED) Open Platform", "social", False,
        "Brand/merchant data and content performance on Xiaohongshu.",
        "A Xiaohongshu brand or merchant account and an approved app on the RED open platform.",
        "Depends on your RED account type.", "https://open.xiaohongshu.com/",
        (Field("app_id", "App ID", False), Field("app_secret", "App secret")),
        "Requires your Xiaohongshu business login to authorize the app.",
    ),
    Connector(
        "wechat", "WeChat (Official Account / WeCom)", "social", False,
        "Supplier and customer messaging and content via WeChat Official Account or WeCom APIs.",
        "A verified WeChat Official Account or WeCom organization (verification usually needs a business entity).",
        "Verification fees may apply.", "https://developers.weixin.qq.com/",
        (Field("app_id", "AppID", False), Field("app_secret", "AppSecret")),
        "Requires your WeChat admin login to create the app.",
    ),
    Connector(
        "alibaba", "Alibaba.com Open Platform", "sourcing", False,
        "Supplier search, product details and RFQs from Alibaba.com.",
        "An Alibaba.com account and an approved app on the Alibaba.com open platform. Until then use Supplier CSV import.",
        "Depends on program.", "https://openapi.alibaba.com/",
        (Field("app_key", "App key", False), Field("app_secret", "App secret")),
    ),
    Connector(
        "alibaba_1688", "1688 Open Platform", "sourcing", False,
        "Factory listings and wholesale prices on 1688.com.",
        "A 1688 account and an approved app on the 1688 open platform (often via a sourcing agent).",
        "Depends on program.", "https://open.1688.com/",
        (Field("app_key", "App key", False), Field("app_secret", "App secret")),
    ),
    Connector(
        "shopify", "Shopify Admin API", "commerce", False,
        "Publish listings, sync products, inventory and orders (every write needs your approval).",
        "A Shopify store and a custom app with an Admin API access token.",
        "Shopify plan fees apply.", "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
        (Field("store_domain", "Store domain (xxx.myshopify.com)", False, "SHOPIFY_STORE_DOMAIN"),
         Field("admin_token", "Admin API access token", True, "SHOPIFY_ADMIN_TOKEN")),
    ),
    Connector(
        "keepa", "Keepa - Amazon price & sales-rank history", "demand", False,
        "Historical Amazon prices and best-seller rank to estimate sales velocity.",
        "A Keepa API subscription.", "Paid subscription; check keepa.com.", "https://keepa.com/#!api",
        (Field("api_key", "API key"),),
    ),
)
BY_KEY = {c.key: c for c in CONNECTORS}

_CACHE: dict[str, tuple[float, dict[str, str]]] = {}
_TTL = 30.0


def _fernet() -> Fernet:
    digest = hashlib.sha256(f"{get_settings().secret_key}|integration-credentials".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _stored_fields(db: Session, key: str) -> dict[str, str]:
    row = db.scalar(select(IntegrationCredential).where(IntegrationCredential.connector == key))
    if row is None:
        return {}
    try:
        return json.loads(_fernet().decrypt(row.encrypted_fields.encode()))
    except (InvalidToken, ValueError):
        return {}  # SECRET_KEY changed; credentials must be re-entered


def get_fields(key: str, db: Session | None = None) -> dict[str, str]:
    """Credentials for a connector: values saved in Settings, falling back to environment variables."""
    hit = _CACHE.get(key)
    if hit and time.monotonic() - hit[0] < _TTL and db is None:
        stored = hit[1]
    elif db is not None:
        stored = _stored_fields(db, key)
    else:
        with session_scope() as s:
            stored = _stored_fields(s, key)
        _CACHE[key] = (time.monotonic(), stored)
    conn = BY_KEY[key]
    out: dict[str, str] = {}
    for f in conn.fields:
        val = stored.get(f.name) or (getattr(get_settings(), f.env.lower(), None) if f.env else None)
        if val:
            out[f.name] = val
    return out


def get_value(key: str, field_name: str) -> str | None:
    return get_fields(key).get(field_name)


def is_configured(key: str) -> bool:
    conn = BY_KEY[key]
    if key == "claude_web_search":
        return bool(get_settings().anthropic_api_key)
    return bool(conn.fields) and all(get_fields(key).get(f.name) for f in conn.fields)


def save(db: Session, key: str, values: dict[str, str], user_id) -> IntegrationCredential:
    conn = BY_KEY[key]
    allowed = {f.name for f in conn.fields}
    current = _stored_fields(db, key)
    for name, value in values.items():
        if name in allowed and value is not None and value.strip():
            current[name] = value.strip()  # blank input keeps the existing value
    row = db.scalar(select(IntegrationCredential).where(IntegrationCredential.connector == key))
    if row is None:
        row = IntegrationCredential(connector=key, encrypted_fields="")
        db.add(row)
    row.encrypted_fields = _fernet().encrypt(json.dumps(current).encode()).decode()
    row.field_hints = {k: ("…" + v[-4:] if len(v) > 4 else "…") for k, v in current.items()}
    row.updated_by_id = user_id
    row.last_test_ok = None
    row.last_test_message = None
    _CACHE.pop(key, None)
    return row


def delete(db: Session, key: str) -> None:
    row = db.scalar(select(IntegrationCredential).where(IntegrationCredential.connector == key))
    if row is not None:
        db.delete(row)
    _CACHE.pop(key, None)


def status(db: Session) -> list[dict[str, Any]]:
    rows = {r.connector: r for r in db.scalars(select(IntegrationCredential))}
    s = get_settings()
    out = []
    for c in CONNECTORS:
        row = rows.get(c.key)
        env_fields = [f.name for f in c.fields if f.env and getattr(s, f.env.lower(), None)]
        configured = is_configured(c.key)
        out.append({
            "key": c.key, "name": c.name, "group": c.group, "active": c.active, "provides": c.provides,
            "requirements": c.requirements, "cost": c.cost, "setup_url": c.setup_url, "login_note": c.login_note,
            "fields": [{"name": f.name, "label": f.label, "secret": f.secret, "env": f.env,
                        "hint": (row.field_hints or {}).get(f.name) if row else None} for f in c.fields],
            "configured": configured,
            "source": "app" if row else ("environment" if env_fields else None),
            "state": ("connected" if configured else "not_connected") if c.active else ("credentials_saved" if row else "not_connected"),
            "last_test_ok": row.last_test_ok if row else None,
            "last_test_message": row.last_test_message if row else None,
            "last_tested_at": row.last_tested_at if row else None,
        })
    return out


def test(db: Session, key: str) -> tuple[bool, str]:
    conn = BY_KEY[key]
    if not conn.active:
        ok, msg = False, "Credentials are stored, but this connector's data adapter is not active yet (planned)."
    elif key == "claude_web_search":
        ok = bool(get_settings().anthropic_api_key)
        msg = "ANTHROPIC_API_KEY is set on the server." if ok else "ANTHROPIC_API_KEY is not set on the server."
    else:
        fields = get_fields(key, db)
        if not all(fields.get(f.name) for f in conn.fields):
            return False, "Enter the required credentials first."
        try:
            ok, msg = _ping(key, fields)
        except httpx2.HTTPError as e:
            ok, msg = False, f"Could not reach the service: {e}"
    row = db.scalar(select(IntegrationCredential).where(IntegrationCredential.connector == key))
    if row is not None:
        row.last_test_ok, row.last_test_message, row.last_tested_at = ok, msg, datetime.now(timezone.utc)
    return ok, msg


def _ping(key: str, fields: dict[str, str]) -> tuple[bool, str]:
    with httpx2.Client(timeout=20) as http:
        if key == "serpapi":
            r = http.get("https://serpapi.com/account.json", params={"api_key": fields["api_key"]})
            if r.status_code != 200:
                return False, f"SerpApi rejected the key (HTTP {r.status_code})."
            d = r.json()
            return True, (f"Connected: {d.get('plan_name') or 'plan'}; "
                          f"{d.get('total_searches_left', d.get('plan_searches_left', '?'))} searches left this month.")
        if key == "tavily":
            r = http.post("https://api.tavily.com/search", headers={"Authorization": f"Bearer {fields['api_key']}"},
                          json={"query": "test", "max_results": 1})
            return (r.status_code == 200, "Connected (used 1 search credit)." if r.status_code == 200 else f"Tavily returned HTTP {r.status_code}.")
        if key == "brave":
            r = http.get("https://api.search.brave.com/res/v1/web/search", params={"q": "test", "count": 1},
                         headers={"X-Subscription-Token": fields["api_key"], "Accept": "application/json"})
            return (r.status_code == 200, "Connected (used 1 query)." if r.status_code == 200 else f"Brave returned HTTP {r.status_code}.")
    return False, "No connection test for this connector."
