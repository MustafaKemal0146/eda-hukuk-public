# syntax=docker/dockerfile:1.7
# Kenar imajı (caddy): resmî Caddy + yalnız DNS-01 sağlayıcısı caddy-dns/cloudflare
# (070 §10.5, 014 §3.1). Rate-limit/WAF eklentisi YOK (hız sınırı uygulama katmanında).
#
# Çalışma koşulları (compose, 070 §4.1): user 10004:10004, read_only kök, cap_drop ALL,
# no-new-privileges, sysctls net.ipv4.ip_unprivileged_port_start=0 (cap_add YOK), birimler
# caddydata:/data ve caddyconfig:/config, tmpfs /tmp. Resmî imajdaki ikili `setcap
# cap_net_bind_service` taşır; no-new-privileges ile dosya yetkili ikili exec edilemez. Bu
# yüzden kendi derlediğimiz (dosya yetkisi OLMAYAN) ikili tabandakinin üzerine kopyalanır.
#
# Sürümler (2026-10-10 doğrulandı):
#   caddy v2.11.7 (GitHub sürümü 2026-10-03), xcaddy v0.4.7 (builder imajında),
#   github.com/caddy-dns/cloudflare v0.2.4 (= a8737d095ad5a48ca031cea6ab704057dbc2d250, 2026-03-23).
# Digestler `docker buildx imagetools inspect` çıktısıdır (çok mimarili dizin digesti).

ARG CADDY_VERSION=2.11.7

FROM caddy:2.11.7-builder@sha256:b25f47453fa02f7e66c0828b4b1343658808b9000950b6825c4a1cb0c988f5f8 AS build
ARG CADDY_VERSION
ARG CADDY_DNS_CLOUDFLARE_VERSION=v0.2.4
# Builder imajı XCADDY_SETCAP=1 taşır (ikiliye cap_net_bind_service yazar); no-new-privileges
# altında böyle bir ikili "exec: operation not permitted" ile açılamaz. Kapatılır ve denetlenir.
ENV CGO_ENABLED=0 XCADDY_SETCAP=0
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    xcaddy build "v${CADDY_VERSION}" \
      --output /out/caddy \
      --with "github.com/caddy-dns/cloudflare@${CADDY_DNS_CLOUDFLARE_VERSION}" \
    && /out/caddy version \
    && /out/caddy list-modules | grep -qx 'dns.providers.cloudflare' \
    && test -z "$(getcap /out/caddy)"

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY --from=build /out/caddy /usr/bin/caddy
RUN test -z "$(getcap /usr/bin/caddy)" \
    && addgroup -S -g 10004 caddy2 \
    && adduser -S -D -H -u 10004 -G caddy2 -h /data -s /sbin/nologin caddy2 \
    && rm -f /etc/caddy/Caddyfile \
    && mkdir -p /data/caddy /config/caddy \
    && chown -R 10004:10004 /data /config \
    && chmod 0750 /data /config \
    && chmod 0700 /data/caddy /config/caddy
# Compose `../caddy:/etc/caddy:ro` bağlar; imaj tek başına da aynı yapılandırmayla açılır.
COPY --chown=0:0 infra/caddy/ /etc/caddy/
# XDG_DATA_HOME=/data, XDG_CONFIG_HOME=/config ve CMD (`caddy run --config /etc/caddy/Caddyfile
# --adapter caddyfile`) tabandan gelir.
USER 10004:10004
