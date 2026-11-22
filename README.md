# AI Commerce OS

An AI-assisted business operating system for launching and growing product businesses. The first use case is **Latin & ballroom dancewear** for the US market, sourced from China, starting with a $5,000 budget. Category, country, budget and assumptions are all editable per project.

The core rule is **no fabricated business data**. Every research finding records its claim, source URL, retrieval date, evidence type, confidence and verification status. AI features without credentials show a configuration requirement instead of producing output.

## What's in this release

| Module | Status | What works |
|---|---|---|
| Business Projects | P0 | Create/edit projects with category, market, sourcing region, budget, price hypothesis and tracked assumptions |
| Market Opportunity | P0 | AI research workflow (web search, then structured extraction, then evidence validation, then synthesis), live run progress, cancel/resume, opportunity reports, findings explorer with human review, segments, sources, report comparison |
| Competitor Intelligence | P0 | AI discovery, manual entry, CSV import, products and price-observation history with sources and timestamps, watchlist, price comparison chart, AI positioning analysis |
| AI Business Copilot | P0 | Tool-calling assistant over your stored records (findings, report, competitors, suppliers, scenarios). Cites sources and only reports writes the server confirmed |
| Brand Studio | P1 | Names, positioning, personas, voice, collections, palettes and messaging, all persisted. Image generation is planned behind an interface |
| Supplier Intelligence | P1 | Supplier records, quotes, communication log, CSV import, landed-cost comparison, AI RFQ drafts (never sent). Verification levels are set only by you |
| Analytics | P1 | Unit-economics calculator with per-input source labels, saved and compared scenarios, price sensitivity, break-even, experiments, AI cost tracking |
| Commerce | P2 | Product catalog, manual inventory, AI listing drafts, approval queue, integration contracts. Shopify, orders and campaigns are planned |

### How evidence is handled

1. **Gather**: the research provider returns real search results. Excerpts are verbatim provider text and are never written by the model.
2. **Extract**: Claude converts the evidence dossier into structured findings, validated against a schema.
3. **Validate (deterministic)**:
   - A finding labelled *sourced* with no retrieved source is downgraded to *AI inference*.
   - Figures in a claim that don't appear in the cited excerpt are flagged and set to low confidence.
   - Quotes must appear verbatim.
   - Competitor prices without a retrieved source are discarded.
4. **Synthesize**: the opportunity report references findings by ID. Unit-economics inputs are tagged *sourced research* or *assumption*, and the math runs in a deterministic calculator, never in the model.

Verification statuses:
- `source_linked`: the automated excerpt check passed. This is not human verification.
- `human_verified` and `disputed`: set only by you.
- `unverified`: no check has passed.

### Agent architecture

The logical agents are Opportunity Research, Competitor Intelligence, Brand Strategy, Sourcing, Commerce, Analytics and Supervisor, plus the Copilot. Each is a bounded service with explicit tools rather than an autonomous loop.

Guardrails:
- Web searches per step, attempts per step, and a USD cost cap per run are all configurable.
- Each research run is persisted with per-step status and can be resumed after a restart.
- Every AI call is recorded as an `AgentExecution` with tokens, searches and estimated cost.
- Every change is recorded as an `AuditEvent`.

LangGraph was not adopted for v1. The research workflow is a fixed, persisted state machine, which is simpler to audit. The provider interfaces (`LLMProvider`, `ResearchProvider`, `CommercePlatform`, `SourcingMarketplace`, `ImageGenerator`) are the extension points.

## Stack

- **Backend:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL, Anthropic Python SDK v2 (`claude-opus-5-5` by default, configurable)
- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Recharts
- **Deploy:** one Render web service (Docker), which serves the API and the static Next.js export from the same origin, plus Render PostgreSQL via `render.yaml`

## Local development

Prerequisites: Python 3.12+, Node 22+, PostgreSQL.

```bash
# Backend
cd backend
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env            # add ANTHROPIC_API_KEY to enable AI features
createdb aicommerce
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal) - proxies /api to :8000
cd frontend
npm install
npm run dev                     # http://localhost:3000
```

Tests use a separate database and a scripted fake LLM, so they make no API calls:

```bash
createdb aicommerce_test
cd backend && .venv/bin/python -m pytest -q
```

## Deploying to Render

1. Push this repository to GitHub.
2. In Render, choose **New, then Blueprint**, and select the repo. Render reads `render.yaml` and creates the `ai-commerce-os` web service and the `ai-commerce-os-db` database.
3. When prompted, enter `ANTHROPIC_API_KEY`. `ALLOWED_SIGNUP_EMAILS`, `TAVILY_API_KEY` and `BRAVE_SEARCH_API_KEY` are optional.
4. After the deploy finishes, open the service URL and sign up. The first account becomes the workspace owner, and later sign-ups are closed unless `SIGNUP_ENABLED=true` or the email is on `ALLOWED_SIGNUP_EMAILS`.

Later pushes to the default branch redeploy automatically. Migrations run on boot.

**Plans:** the Blueprint uses `free` plans so it can be created at no cost. Free web services sleep when idle, and **free Postgres databases expire after 30 days**. For real use, switch the database to a paid plan (for example `0.1c-256mb`) and the web service to `0.5c-512mb` or larger.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required for every AI feature |
| `LLM_MODEL` / `LLM_EFFORT` | `claude-opus-5-5` / `medium` | Model and reasoning effort |
| `ANTHROPIC_FALLBACKS` | `default` | Server-side refusal fallback (beta). Set `off` to disable |
| `RESEARCH_PROVIDER` | `anthropic_web_search` | `anthropic_web_search`, `tavily` or `brave`. Web search must be enabled for your Anthropic org |
| `MAX_SEARCHES_PER_STEP` / `MAX_RESEARCH_COST_USD` / `MAX_STEP_ATTEMPTS` | `5` / `5` / `2` | Research guardrails |
| `SIGNUP_ENABLED` / `ALLOWED_SIGNUP_EMAILS` | `false` / empty | Who can register after the first user |

### Known limits of this MVP

- Research runs execute inside the web process, so keep a **single instance**. Scaling out needs a separate worker service with a DB-backed queue.
- Costs shown in the app are estimates from token usage and list prices. Your Anthropic invoice is authoritative.
- Shopify, Alibaba/1688, ads and image generation have interfaces but no live connection. Every external action will require explicit approval through the existing approval queue.
