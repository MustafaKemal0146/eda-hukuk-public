# syntax=docker/dockerfile:1.7
# doc-engine imajı (070 §10.4).

FROM ghcr.io/astral-sh/uv:0.12.24@sha256:3af4716e991d6956a41e573eab705d0ee08500cd829ed30293eb8472f372c65a AS uv

FROM python:3.14-slim-trixie@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS base
COPY --from=uv /uv /uvx /usr/local/bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON=/usr/local/bin/python3 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=UTC
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-tur tesseract-ocr-eng qpdf libgl1 libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pyproject.toml uv.lock ./
COPY services/doc-engine/pyproject.toml services/doc-engine/pyproject.toml
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --package eda-doc-engine --no-install-workspace
COPY services/doc-engine/src services/doc-engine/src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --package eda-doc-engine

FROM deps AS models
# Docling model dizini (/opt/models) (070 §10.4)
RUN mkdir -p /opt/models

FROM base AS runtime
RUN groupadd -g 10006 docengine && useradd -u 10006 -g 10006 -M -s /usr/sbin/nologin docengine
COPY --from=deps   --chown=10006:10006 /opt/venv /opt/venv
COPY --from=deps   --chown=10006:10006 /app/services/doc-engine/src /app/src
COPY --from=deps   --chown=10006:10006 /app/services/doc-engine/src /app/services/doc-engine/src
COPY --from=models --chown=10006:10006 /opt/models /opt/models
ENV PATH=/opt/venv/bin:$PATH PYTHONPATH=/app/src:/app/services/doc-engine/src HF_HUB_OFFLINE=1 DOCLING_ARTIFACTS_PATH=/opt/models OMP_THREAD_LIMIT=1
RUN tesseract --list-langs | grep -qx tur && tesseract --list-langs | grep -qx eng
USER 10006:10006
WORKDIR /app
CMD ["uvicorn", "eda_doc_engine.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8002", "--workers", "1"]

FROM deps AS dev
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --package eda-doc-engine --no-install-workspace
COPY --from=models /opt/models /opt/models
ENV PATH=/opt/venv/bin:$PATH HF_HUB_OFFLINE=1 DOCLING_ARTIFACTS_PATH=/opt/models
USER 10006:10006
