"""FastAPI entrypoint. Serves /api/* and, in production, the exported Next.js frontend."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.responses import FileResponse, JSONResponse

from .api import (
    analytics,
    auth,
    brand,
    channels,
    commerce,
    competitors,
    connectors_api,
    copilot,
    decisions,
    outreach,
    projects,
    research,
    scans,
    sizing,
    suppliers,
    system,
    tokens,
    trends,
)
from .config import get_settings
from .mcp_server import MCPMiddleware, session_manager
from .services import naming
from .services.agents.opportunity import recover_interrupted_runs
from .services.llm.base import LLMError, LLMNotConfigured, LLMRefusal, LLMTransientError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("aicos")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.is_production and settings.secret_key == "dev-insecure-change-me":
        raise RuntimeError("SECRET_KEY must be set in production.")
    try:
        n = recover_interrupted_runs()
        if n:
            log.warning("Marked %d in-flight research run(s) as interrupted", n)
        naming.backfill_in_background()
    except Exception:  # noqa: BLE001 - DB may not be migrated yet in dev
        log.exception("Could not check for interrupted runs")
    async with session_manager.run():  # Claude connector (MCP) transport
        yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)


@app.exception_handler(LLMNotConfigured)
async def _not_configured(_: Request, exc: LLMNotConfigured) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": {"code": "ai_not_configured", "message": str(exc)}})


@app.exception_handler(LLMRefusal)
async def _refusal(_: Request, exc: LLMRefusal) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": {"code": "ai_refusal", "message": str(exc)}})


@app.exception_handler(LLMTransientError)
async def _transient(_: Request, exc: LLMTransientError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": {"code": "ai_unavailable",
                                                             "message": "The AI service is busy or unreachable. Please try again shortly."}})


@app.exception_handler(LLMError)
async def _llm_error(_: Request, exc: LLMError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": {"code": "ai_error", "message": str(exc)}})


for r in (auth, projects, research, competitors, brand, suppliers, channels, commerce, analytics, copilot, system,
          connectors_api, scans, decisions, tokens, sizing, outreach, trends):
    app.include_router(r.router)
app.add_middleware(MCPMiddleware)


# ----------------------------------------------------------------------------- static frontend

DIST = (Path(__file__).resolve().parent.parent / settings.frontend_dist).resolve()


def _static(path: Path, status_code: int = 200) -> FileResponse:
    # Hashed build assets never change; HTML and RSC payloads must revalidate after each deploy.
    immutable = "/_next/static/" in path.as_posix()
    cache = "public, max-age=31536000, immutable" if immutable else "no-cache"
    return FileResponse(path, status_code=status_code, headers={"Cache-Control": cache})


# Next.js prefetches pages with HEAD requests, so accept both methods.
@app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def frontend(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404, "Not found")
    if not DIST.is_dir():
        return JSONResponse({"detail": "Frontend build not found. Run the Next.js dev server for local development."}, status_code=404)
    candidate = (DIST / full_path).resolve()
    if DIST not in candidate.parents and candidate != DIST:
        raise HTTPException(404, "Not found")
    if candidate.is_file():
        return _static(candidate)
    for alt in (candidate.with_suffix(".html"), candidate / "index.html"):
        if alt.is_file():
            return _static(alt)
    fallback = DIST / "404.html"
    return _static(fallback, 404) if fallback.is_file() else _static(DIST / "index.html")
