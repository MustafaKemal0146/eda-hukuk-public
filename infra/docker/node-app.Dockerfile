# syntax=docker/dockerfile:1.7
# Node uygulama imajları (070 §10.1): web, admin, api, worker, yargi-mcp, migrate, devtools, ci.
# HEALTHCHECK yazılmaz; compose tanımlar. Her hedef `--target <ad> --build-arg APP=@eda/<paket>` ile derlenir.
ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.12.24@sha256:3af4716e991d6956a41e573eab705d0ee08500cd829ed30293eb8472f372c65a
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
ARG TURBO_VERSION=2.11.7

FROM ${UV_IMAGE} AS uv

# --- base: pnpm (packageManager sürümü + sha512 bütünlüğü) ve turbo ----
FROM ${NODE_IMAGE} AS base
ARG TURBO_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 \
    COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json /tmp/pm/package.json
RUN corepack enable && cd /tmp/pm && corepack install && chmod -R a+rX /opt/corepack \
 && npm install -g --no-fund --no-audit "turbo@${TURBO_VERSION}" && rm -rf /tmp/pm /root/.npm
WORKDIR /repo

# ---- prune: yalnız hedef uygulamanın bağımlılık ağacı (013 Tuzak 8) ----
FROM base AS prune
ARG APP
COPY . .
RUN test -n "${APP}" && turbo prune "${APP}" --docker

# ---- build: kurulum + derleme + /out/<paket> (dist + yalnız external üretim bağımlılıkları) ----
FROM base AS build
ARG APP
COPY --from=prune /repo/out/json/ .
COPY --from=prune /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=prune /repo/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN turbo run build --filter="${APP}"
# tsdown paketleri (api, worker, yargi-mcp, db): dist + yalnız üretim bağımlılıkları. Next uygulamaları
# .next/standalone kullanır; onlarda /out/app boş kalır.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pkgdir="$(pnpm --filter "${APP}" exec pwd)" && mkdir -p /out/app \
 && if [ -d "${pkgdir}/dist" ]; then \
      pnpm --filter "${APP}" deploy --prod --legacy /out/app \
   && rm -rf /out/app/src /out/app/test /out/app/bin /out/app/dist /out/app/.turbo \
             /out/app/scripts /out/app/tsconfig.json /out/app/*.config.ts \
   && cp -r "${pkgdir}/dist" /out/app/dist; \
    fi

# ---- runtime-base: kök dışı kullanıcı 10001, salt dosyalar ----
FROM ${NODE_IMAGE} AS runtime-base
ENV NODE_ENV=production TZ=UTC
# Çalışma zamanında paket yöneticisi gerekmez: taban imajın npm/corepack kopyaları silinir (yalnız node
# kalır). images-scan Trivy kapısı bu paketlerin düzeltmesi olan HIGH bulgularını gösteriyordu (P02).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && groupadd -g 10001 eda && useradd -u 10001 -g 10001 -M -s /usr/sbin/nologin eda \
 && mkdir -p /app /opt/eda && chown 10001:10001 /app
COPY infra/docker/healthcheck.mjs /opt/eda/healthcheck.mjs
WORKDIR /app
USER 10001:10001

FROM runtime-base AS web
COPY --from=build --chown=10001:10001 /repo/apps/web/.next/standalone ./
COPY --from=build --chown=10001:10001 /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=10001:10001 /repo/apps/web/public ./apps/web/public
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]

FROM runtime-base AS admin
COPY --from=build --chown=10001:10001 /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=10001:10001 /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=10001:10001 /repo/apps/admin/public ./apps/admin/public
ENV PORT=3001 HOSTNAME=0.0.0.0
CMD ["node", "apps/admin/server.js"]

FROM runtime-base AS api
COPY --from=build --chown=10001:10001 /out/app/ ./
CMD ["node", "dist/main.js"]

FROM runtime-base AS worker
COPY --from=build --chown=10001:10001 /out/app/ ./
CMD ["node", "dist/main.js"]

FROM runtime-base AS yargi-mcp
COPY --from=build --chown=10001:10001 /out/app/ ./
CMD ["node", "dist/main.js"]

# migrate: dist/bin/{migrate,seed}.js + migrations/ (SQL + meta) ve audit/ (Q1–Q12, E-serisi) paket
# kökünden pnpm deploy ile gelir; çalıştırıcı bunları /app altından okur (032 §6.5).
FROM runtime-base AS migrate
COPY --from=build --chown=10001:10001 /out/app/ ./
CMD ["node", "dist/bin/migrate.js"]

# ---- devtools: make hedeflerinin araç imajı (yalnız compose.dev.yaml; prod'da derlenmez) ----
FROM base AS devtools
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssl curl ca-certificates jq \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory /workspace
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /workspace

# ---- ci: test-runner (yalnız compose.test.yaml; P01c derler) ----
FROM ${NODE_IMAGE} AS node-bin
FROM ${PLAYWRIGHT_IMAGE} AS ci
ARG TURBO_VERSION
COPY --from=node-bin /usr/local/bin/node /usr/local/bin/node
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY --from=base /opt/corepack /opt/corepack
COPY package.json /tmp/pm/package.json
RUN corepack enable && cd /tmp/pm && corepack install \
 && npm install -g --no-fund --no-audit "turbo@${TURBO_VERSION}" && rm -rf /tmp/pm
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /workspace
