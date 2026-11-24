"""Test setup: a dedicated Postgres database and a fake LLM so no real API calls happen."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://localhost:5432/aicommerce_test")
os.environ["ANTHROPIC_API_KEY"] = ""  # tests must never call the real API
os.environ["SECRET_KEY"] = "test-secret-that-is-long-enough-for-hs256"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def no_1688(monkeypatch):
    """1688 pages are free to read, so agents fetch them without a key - tests get an empty page instead of the network."""
    monkeypatch.setattr("app.services.demand._p1688_page", lambda http, url: "")


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def authed(client: TestClient) -> TestClient:
    r = client.post("/api/auth/signup", json={"email": "founder@example.com", "password": "correct-horse-1"})
    assert r.status_code == 200, r.text
    return client


@pytest.fixture
def project(authed: TestClient) -> dict:
    r = authed.post("/api/projects", json={
        "name": "Latin dancewear", "product_category": "Latin and ballroom dancewear", "target_country": "United States",
        "sourcing_country": "China", "budget_usd": 5000, "target_customers": "Adult recreational dancers",
        "price_min": 49, "price_max": 89,
        "assumptions": [{"label": "Price", "value": "$49-$89", "status": "hypothesis"}],
    })
    assert r.status_code == 201, r.text
    return r.json()
