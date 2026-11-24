"""Short product names for the sidebar: 2-4 words the AI suggests once (a fraction of a cent), with a rule-based
fallback. The full name stays on the report and in hover text."""

from __future__ import annotations

import logging
import re
import threading

from pydantic import BaseModel, Field
from sqlalchemy import select

from ..db import session_scope
from ..models import BusinessProject
from .agents.runtime import apply_usage, finish_execution, start_execution
from .llm.anthropic_provider import get_llm

log = logging.getLogger(__name__)
MAX_LEN = 40
AUDIENCE = re.compile(r"^(women'?s|men'?s|kids'?|girls'?|boys'?|unisex|adult)\s+", re.I)


class ShortName(BaseModel):
    short_name: str = Field(description="2-4 words, at most 28 characters, keeping the words that tell this product apart")


SYSTEM = """You give a product a short name for a narrow sidebar list: 2-4 words, at most 28 characters, title case.
Keep the words that tell it apart from the founder's other products (listed); drop audience words (Women's, Men's)
unless they are what distinguishes it, and drop details like '(igloo style)' or 'with plug-in controller'."""


def heuristic(name: str) -> str:
    """'Heated covered cat bed cave (igloo style) with plug-in controller' -> 'Heated covered cat bed cave'."""
    s = re.sub(r"\([^)]*\)", " ", name)
    s = re.split(r"\s+(?:with|for)\s+|\s+-\s+|,", s, maxsplit=1)[0]
    s = AUDIENCE.sub("", s.strip())
    words: list[str] = []
    for w in s.split()[:5]:  # whole words only, never cut mid-word
        if len(" ".join([*words, w])) > 32:
            break
        words.append(w)
    while words and words[-1].lower() in ("and", "&", "or", "with", "for", "the", "of", "a"):
        words.pop()  # never end on a connector ("... wear and")
    out = " ".join(words)
    return out[:1].upper() + out[1:] if out else name[:MAX_LEN]


def suggest(db, project: BusinessProject, user_id=None) -> str:
    """Ask the AI once; on any error fall back to the rule."""
    others = [n for n in db.scalars(select(BusinessProject.name).where(BusinessProject.owner_id == project.owner_id,
                                                                       BusinessProject.id != project.id)).all()][:30]
    llm = get_llm()
    if not llm.is_configured():
        return heuristic(project.name)
    ex = start_execution(db, agent="brand_strategy", operation="short_name", project_id=project.id, user_id=user_id, model=llm.model,
                         input_summary=project.name[:500])
    try:
        out, usage = llm.structured(system=SYSTEM, output_model=ShortName, max_tokens=1000,
                                    prompt=f"Product: {project.name}\nCategory: {project.product_category}\nOther products: "
                                           + ("; ".join(others) or "(none)"))
        apply_usage(ex, usage)
        finish_execution(ex, output=out.model_dump())
        short = re.sub(r"\s+", " ", out.short_name).strip().strip('"')[:MAX_LEN]
        return short or heuristic(project.name)
    except Exception as e:  # noqa: BLE001 - a missing key or a bad answer should never block creating a product
        finish_execution(ex, error=str(e)[:500])
        return heuristic(project.name)


def backfill_in_background() -> None:
    """Products created before short names existed get one, once, without slowing start-up."""
    def work() -> None:
        try:
            with session_scope() as db:
                ids = db.scalars(select(BusinessProject.id).where(BusinessProject.short_name.is_(None)).limit(100)).all()
            for pid in ids:
                with session_scope() as db:
                    p = db.get(BusinessProject, pid)
                    if p is not None and p.short_name is None:
                        p.short_name = suggest(db, p, p.owner_id)
        except Exception:  # noqa: BLE001
            log.exception("Back-filling short product names failed")

    threading.Thread(target=work, daemon=True, name="short-names").start()
