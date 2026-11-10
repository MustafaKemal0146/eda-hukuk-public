# E.D.A. Hukuk — Ağ izolasyon test aracı imajı (070 §6, TK-27, KK-P01c-10).
FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

RUN apk add --no-cache curl bind-tools busybox-extras ca-certificates

USER 65534:65534
ENTRYPOINT ["/bin/sh"]
