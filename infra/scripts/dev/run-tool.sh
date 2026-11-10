#!/usr/bin/env bash
# Geliştirici araç sarmalayıcısı (Makefile TOOLS): Node/pnpm/openssl komutlarını host'a kurulum
# gerektirmeden `node-app.Dockerfile` devtools hedefinde ve geçerli kullanıcı kimliğiyle çalıştırır (Y-109).
# Compose'a bağlı değildir: sırlar ve env dosyaları oluşmadan önce de (make setup/secrets) çalışır.
#
# Kullanım: infra/scripts/dev/run-tool.sh <komut> [argümanlar...]
#   RUN_TOOL_NETWORK=none  ağsız çalıştırır (varsayılan: ağ açık; pnpm install için gerekir)
#   RUN_TOOL_ENV="A B"     yalnız adı verilen env değişkenlerini konteynıra geçirir
set -euo pipefail

readonly IMAGE="eda/devtools:dev"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly REPO_ROOT

if [[ $# -eq 0 ]]; then
  echo "kullanım: $0 <komut> [argümanlar...]" >&2
  exit 2
fi

# İmaj yalnız Dockerfile veya packageManager değişince yeniden derlenir (katman önbelleği).
docker build -q --target devtools -t "$IMAGE" -f "$REPO_ROOT/infra/docker/node-app.Dockerfile" \
  "$REPO_ROOT" >/dev/null

tty_flags=()
if [[ -t 0 && -t 1 ]]; then tty_flags=(-it); fi

env_flags=()
for name in ${RUN_TOOL_ENV:-}; do env_flags+=(-e "$name"); done

# git worktree: `.git` bir dosyadır ve ortak git dizinini mutlak yolla gösterir. Konteynırda git
# (ls-files, biome --staged, turbo --affected) çalışsın diye ortak dizin aynı yola bağlanır. turbo
# önbelleği ortak dizinin yanına yazmaya çalışmasın diye çalışma ağacına sabitlenir.
git_flags=()
common_dir="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$common_dir" && "$common_dir" != "$REPO_ROOT/.git" ]]; then
  git_flags=(-v "$common_dir:$common_dir" -e TURBO_CACHE_DIR=/workspace/.turbo/cache)
fi

exec docker run --rm "${tty_flags[@]}" \
  --network "${RUN_TOOL_NETWORK:-bridge}" \
  -u "$(id -u):$(id -g)" \
  -v "$REPO_ROOT:/workspace" -w /workspace \
  "${git_flags[@]}" \
  -v eda-pnpm-store:/pnpm-store \
  -e HOME=/tmp/home \
  -e npm_config_store_dir=/pnpm-store \
  -e TURBO_TELEMETRY_DISABLED=1 \
  -e NEXT_TELEMETRY_DISABLED=1 \
  -e CI=1 \
  -e NO_COLOR=1 \
  -e EDA_ENV="${EDA_ENV:-test}" \
  "${env_flags[@]}" \
  "$IMAGE" \
  sh -c 'mkdir -p /tmp/home && exec "$@"' run-tool "$@"
