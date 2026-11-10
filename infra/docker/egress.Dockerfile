# syntax=docker/dockerfile:1.7
# Çıkış vekili imajı (smokescreen): egress-llm, egress-portal, egress-backup, egress-av
# (070 §10.6, 014 §3.18). Komut satırı compose'dan gelir:
#   --listen-ip 0.0.0.0 --listen-port 4750 --egress-acl-file /etc/smokescreen/<vekil>.yaml
# Rolsüz (mTLS'siz) isteklerde ACL'in `default` bloğunun uygulanması için `allow_missing_role`
# gerekir; bu ayar yalnız --config-file ile verilebildiğinden taban yapılandırma imaja gömülür ve
# ENTRYPOINT'te okunur (infra/egress/config/smokescreen.yaml). Komut satırı bayrakları dosyadaki
# değerleri ezer.

FROM golang:1.27.2-alpine3.24@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
# Sabit commit (github.com/stripe/smokescreen master, 2026-10-10); dal adı YASAK.
ARG SMOKESCREEN_COMMIT=99be9f595dc6eb3876f8d7c0ac36d64f886158de
RUN case "${SMOKESCREEN_COMMIT}" in \
      *[!0-9a-f]*) echo "SMOKESCREEN_COMMIT 40 haneli küçük harf hex olmalı" >&2; exit 1 ;; \
    esac \
    && test "${#SMOKESCREEN_COMMIT}" -eq 40 \
    || { echo "SMOKESCREEN_COMMIT 40 hane olmalı" >&2; exit 1; }
RUN apk add --no-cache git \
    && git init -q /src \
    && git -C /src remote add origin https://github.com/stripe/smokescreen \
    && git -C /src fetch -q --depth 1 origin "${SMOKESCREEN_COMMIT}" \
    && git -C /src checkout -q FETCH_HEAD \
    && test "$(git -C /src rev-parse HEAD)" = "${SMOKESCREEN_COMMIT}"
WORKDIR /src
# Depo vendor/ dizinini taşır; ağdan modül indirilmez.
RUN CGO_ENABLED=0 GOFLAGS=-mod=vendor go build -trimpath -ldflags="-s -w" -o /out/smokescreen . \
    && /out/smokescreen --help >/dev/null

FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
# `nc` (busybox, -z destekli) yalnız compose healthcheck'i içindir; ek paket kurulmaz.
COPY --from=build /out/smokescreen /usr/local/bin/smokescreen
COPY infra/egress/config/smokescreen.yaml /etc/smokescreen/config.yaml
USER 10002:10002
EXPOSE 4750
ENTRYPOINT ["/usr/local/bin/smokescreen", "--config-file", "/etc/smokescreen/config.yaml"]
