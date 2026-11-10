# syntax=docker/dockerfile:1.7
# PostgreSQL 18 + pgvector (kaynaktan, OPTFLAGS="") + pg_textsearch (PGDG) + tr_hukuk FTS + pgBackRest (PGDG).
# Plan: 070 §10.2, P01a.7. Bağlam: repo kökü (compose: context ../.., dockerfile infra/docker/postgres.Dockerfile).
# entrypoint-wrapper.sh ve pgbackrest*.conf P01c'de eklenir; HEALTHCHECK compose'da tanımlanır (tek yer).
# Sürüm doğrulaması 2026-10-10: postgres:18.6-trixie en yeni 18.x yamasıdır (imagetools inspect).
ARG PG_IMAGE=postgres:18.6-trixie@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336

# ---------------------------------------------------------------- derleme aşaması
FROM ${PG_IMAGE} AS build
ARG PGVECTOR_VERSION=0.8.7
# GitHub etiket arşivi (refs/tags/v0.8.7.tar.gz) sha256'sı; curl | sha256sum ile hesaplandı.
ARG PGVECTOR_SHA256=cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential postgresql-server-dev-18 curl ca-certificates clang llvm \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# OPTFLAGS="": -march=native kapalı; derleme makinesinden farklı CPU'da "illegal instruction" oluşmaz (KK-070-11).
RUN curl -fsSLo pgvector.tgz "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz" \
 && echo "${PGVECTOR_SHA256}  pgvector.tgz" | sha256sum -c - \
 && tar xzf pgvector.tgz \
 && make -C "pgvector-${PGVECTOR_VERSION}" OPTFLAGS="" \
 && make -C "pgvector-${PGVECTOR_VERSION}" OPTFLAGS="" install DESTDIR=/out

# ---------------------------------------------------------------- çalışma aşaması
FROM ${PG_IMAGE}
# PGDG paketleri sabit sürümle (resmî imajda PGDG deposu hazırdır).
# pg_textsearch: ön derlenmiş PGDG paketi tercih edildi (070 §10.2 notu); kaynak derlemesi gerekmez.
# pgbackrest: backup.Dockerfile (P01c) AYNI sürümü kullanmalıdır (073 §4; TLS protokolü sürüm uyuşmazlığını reddeder).
ARG PG_TEXTSEARCH_DEB_VERSION=1.5.1-1.pgdg13+1
ARG PGBACKREST_DEB_VERSION=2.59.3-1.pgdg13+1
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      "postgresql-18-pg-textsearch=${PG_TEXTSEARCH_DEB_VERSION}" \
      "pgbackrest=${PGBACKREST_DEB_VERSION}" \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ /
# tr_hukuk sözlükleri (023 §3): tr_hukuk_protected.syn, tr_hukuk.stop
COPY --chmod=0644 infra/postgres/tsearch_data/ /usr/share/postgresql/18/tsearch_data/
COPY --chmod=0644 infra/postgres/postgresql.conf infra/postgres/pg_hba.conf /etc/postgresql/
COPY --chmod=0755 infra/postgres/entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN install -d -m 0755 /etc/pgbackrest
COPY --chmod=0644 infra/postgres/pgbackrest.conf infra/postgres/pgbackrest-restore.conf /etc/pgbackrest/
# initdb betikleri yalnız boş pgdata biriminde koşar (010 → 050 sırası, 070 §10.2)
COPY --chmod=0644 infra/postgres/initdb/ /docker-entrypoint-initdb.d/
USER 999:999

