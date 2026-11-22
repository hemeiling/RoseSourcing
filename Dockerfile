# syntax=docker/dockerfile:1
# Single-service image: Next.js static export served by FastAPI on the same origin.

# ---- 1. Build the frontend ----------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN NEXT_OUTPUT=export npm run build

# ---- 2. Python runtime --------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ .
COPY --from=web /web/out /app/frontend/out
ENV FRONTEND_DIST=../frontend/out
RUN useradd --create-home appuser && chown -R appuser /app
USER appuser
EXPOSE 10000
# Migrations run on boot (single instance). Research runs execute in-process, so keep one worker.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
