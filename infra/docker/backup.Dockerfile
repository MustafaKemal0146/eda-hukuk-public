# syntax=docker/dockerfile:1.7
# backup imajı (070 §10.7, 073 §7.1)
ARG DEBIAN_IMAGE=debian:trixie-slim@sha256:918311b7b6c4c6f68b232ba516584925f6c78ad82b6fd534b98979df6438e483
ARG RESTIC_VERSION=0.17.3
ARG RESTIC_SHA256=5097faeda6aa13167aae6e36efdba636637f8741fed89bbf015678334632d4d3
ARG SUPERCRONIC_VERSION=0.2.33
ARG SUPERCRONIC_SHA256=feefa310da569c81b99e1027b86b27b51e6ee9ab647747b49099645120cfc671
ARG PGBACKREST_DEB_VERSION=2.59.3-1.pgdg13+1

FROM ${DEBIAN_IMAGE}
ARG RESTIC_VERSION
ARG RESTIC_SHA256
ARG SUPERCRONIC_VERSION
ARG SUPERCRONIC_SHA256
ARG PGBACKREST_DEB_VERSION

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg bzip2 busybox-static jq \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg \
  && echo 'deb http://apt.postgresql.org/pub/repos/apt trixie-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends "pgbackrest=${PGBACKREST_DEB_VERSION}" \
  && curl -fsSLo /tmp/restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2" \
  && echo "${RESTIC_SHA256}  /tmp/restic.bz2" | sha256sum -c - \
  && bunzip2 /tmp/restic.bz2 \
  && mv /tmp/restic /usr/local/bin/restic \
  && chmod 0755 /usr/local/bin/restic \
  && curl -fsSLo /usr/local/bin/supercronic "https://github.com/aptible/supercronic/releases/download/v${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
  && echo "${SUPERCRONIC_SHA256}  /usr/local/bin/supercronic" | sha256sum -c - \
  && chmod 0755 /usr/local/bin/supercronic \
  && apt-get purge -y gnupg bzip2 \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* /tmp/*

COPY infra/backup/ /etc/eda-backup/
COPY --chmod=0755 infra/backup/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chmod=0755 infra/scripts/backup-run.sh infra/scripts/offsite-sync.sh infra/scripts/backup-init.sh infra/scripts/backup-lib.sh /usr/local/bin/

RUN groupmod -g 10007 backup && usermod -u 10007 -g 10007 -s /usr/sbin/nologin backup \
  && mkdir -p /var/lib/pgbackrest /run/eda /tmp/pgbackrest \
  && chown -R 10007:10007 /var/lib/pgbackrest /run/eda /tmp/pgbackrest

USER 10007:10007
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
