"""Claude connector: an MCP (Streamable HTTP) endpoint at /mcp exposing the app's workflow tools.

Add it in Claude as a custom connector. Authenticate with a personal token from Settings, either as
`Authorization: Bearer <token>` or as `?token=<token>` in the connector URL (for clients that cannot
set headers). Project tools take a `project_id`; use list_projects / create_project first.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import anyio
from fastapi import HTTPException
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from sqlalchemy import select
from starlette.responses import JSONResponse

from . import audit
from .db import SessionLocal
from .models import ApiToken, BusinessProject, User
from .security import get_project_for_user
from .services.agents.copilot import TOOLS, CopilotTools

log = logging.getLogger(__name__)
TOKEN_PREFIX = "aicos_"

INSTRUCTIONS = (
    "RoseSourcing: evidence-linked product research and launch workspace. Each product or category the founder evaluates is a "
    "project. Call list_projects (or create_project for a new product), then pass project_id to the step tools: start_research, "
    "research_status, get_opportunity_report, search_findings, competitors, suppliers, channels, shipping, unit economics, "
    "brand concepts, decision briefs and record_decision. Cite findings with their evidence type and source links. Never claim "
    "an action happened unless the tool result says ok: true. record_decision is only for the founder's explicit decision."
)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def user_for_token(db, token: str | None) -> User | None:
    if not token or not token.startswith(TOKEN_PREFIX):
        return None
    row = db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(token), ApiToken.revoked_at.is_(None)))
    if row is None:
        return None
    now = datetime.now(timezone.utc)
    if row.last_used_at is None or now - row.last_used_at > timedelta(minutes=5):
        row.last_used_at = now
        db.commit()
    user = db.get(User, row.user_id)
    return user if user and user.is_active else None


def _token_from_scope(scope: dict) -> str | None:
    headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers") or []}
    auth = headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    from urllib.parse import parse_qs

    return (parse_qs((scope.get("query_string") or b"").decode()).get("token") or [None])[0]


# ----------------------------------------------------------------------------- tools

PROJECT_ID = {"project_id": {"type": "string", "description": "Project (product/category) id from list_projects"}}

EXTRA_TOOLS = [
    types.Tool(name="list_projects", description="List the founder's product/category projects with research status, AI recommendation and decision.",
               input_schema={"type": "object", "properties": {}, "additionalProperties": False}),
    types.Tool(name="create_project", description="Create a project for a new product or category to evaluate.",
               input_schema={"type": "object", "required": ["name", "product_category", "target_country"], "additionalProperties": False,
                             "properties": {"name": {"type": "string"}, "product_category": {"type": "string"},
                                            "target_country": {"type": "string"}, "sourcing_country": {"type": "string"},
                                            "budget_usd": {"type": "number"}, "target_customers": {"type": "string"},
                                            "price_min": {"type": "number"}, "price_max": {"type": "number"}}}),
]


def _project_tool(spec) -> types.Tool:
    schema = json.loads(json.dumps(spec.input_schema))
    schema.setdefault("properties", {}).update(PROJECT_ID)
    schema["required"] = ["project_id"] + [r for r in schema.get("required", []) if r != "project_id"]
    schema.pop("title", None)
    return types.Tool(name=spec.name, description=spec.description, input_schema=schema)


ALL_TOOLS = EXTRA_TOOLS + [_project_tool(t) for t in TOOLS]


def _dispatch(user_id: uuid.UUID, name: str, args: dict[str, Any]) -> tuple[bool, str]:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if name == "list_projects":
            from .api.decisions import pipeline

            return True, json.dumps({"ok": True, "projects": pipeline(db, user)}, default=str)
        if name == "create_project":
            dec = lambda v: Decimal(str(v)) if v is not None else None  # noqa: E731
            p = BusinessProject(owner_id=user.id, name=str(args.get("name", ""))[:200], product_category=str(args.get("product_category", ""))[:200],
                                target_country=str(args.get("target_country", ""))[:100], sourcing_country=args.get("sourcing_country"),
                                budget_usd=dec(args.get("budget_usd")), target_customers=args.get("target_customers"),
                                price_min=dec(args.get("price_min")), price_max=dec(args.get("price_max")), assumptions=[])
            db.add(p)
            db.flush()
            audit.record(db, "project.created", user_id=user.id, project_id=p.id, actor="agent:claude_connector", entity_type="project", entity_id=p.id)
            db.commit()
            return True, json.dumps({"ok": True, "project_id": str(p.id), "name": p.name})
        try:
            project = get_project_for_user(uuid.UUID(str(args.pop("project_id", ""))), db, user)
        except (HTTPException, ValueError):
            return False, json.dumps({"ok": False, "error": "Unknown project_id. Call list_projects first."})
        ok, content, _summary = CopilotTools(db, project, user).execute(name, args)
        return ok, content


async def _list_tools(ctx, params) -> types.ListToolsResult:
    return types.ListToolsResult(tools=ALL_TOOLS)


async def _call_tool(ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
    scope = ctx.request.scope if ctx.request is not None else {}
    token = _token_from_scope(scope)

    def run() -> tuple[bool, str]:
        with SessionLocal() as db:
            user = user_for_token(db, token)
            uid = user.id if user else None
        if uid is None:
            return False, json.dumps({"ok": False, "error": "Invalid or revoked token. Create one in Settings > Claude connector."})
        return _dispatch(uid, params.name, dict(params.arguments or {}))

    ok, text = await anyio.to_thread.run_sync(run)
    return types.CallToolResult(content=[types.TextContent(type="text", text=text)], is_error=not ok)


server = Server("ai-commerce-os", version="0.1.0", instructions=INSTRUCTIONS, on_list_tools=_list_tools, on_call_tool=_call_tool)
session_manager = StreamableHTTPSessionManager(app=server, stateless=True, json_response=True)


class MCPMiddleware:
    """Routes /mcp to the MCP transport after checking the token; everything else goes to FastAPI."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "http" and scope["path"].rstrip("/") == "/mcp":
            token = _token_from_scope(scope)

            def check() -> bool:
                with SessionLocal() as db:
                    return user_for_token(db, token) is not None

            if not await anyio.to_thread.run_sync(check):
                resp = JSONResponse({"error": "unauthorized", "message": "Create a token in Settings > Claude connector."}, status_code=401)
                return await resp(scope, receive, send)
            return await session_manager.handle_request(scope, receive, send)
        return await self.app(scope, receive, send)
