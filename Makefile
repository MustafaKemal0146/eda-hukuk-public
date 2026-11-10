# E.D.A. Hukuk — kök Makefile (071 §4). Host'ta yalnız make, bash, docker, git gerekir (Y-109).
# Node/pnpm komutları araç konteynırında (TOOLS), Python komutları doc-engine imajında koşar.

SHELL         := /bin/bash
.SHELLFLAGS   := -euo pipefail -c
.DEFAULT_GOAL := help

ENV      ?= dev
TAG      ?= $(shell git rev-parse --short=12 HEAD 2>/dev/null || echo dev)
PROFILES ?=
HOT      ?= 0
WATCH    ?= 1
LLM      ?= mock
EMBED    ?= mock
BATCH    ?= 0
SUITE    ?= fast
KEEP     ?= 0
SYSTEM   ?= 0
S        ?=
AFFECTED ?= 0

# TOOLS: node-app.Dockerfile devtools hedefi (compose'a bağımlı değil). DEV: compose sarmalayıcısı.
TOOLS     = infra/scripts/dev/run-tool.sh
DEV       = infra/scripts/dev/dc.sh dev
DOCENGINE = infra/scripts/dev/doc-engine-run.sh
TESTDB    = infra/scripts/dev/test-db.sh
CI        = $(TOOLS) node infra/scripts/ci
TURBO     = $(TOOLS) pnpm turbo run --filter='!eda-doc-engine'

.PHONY: help setup secrets dev down logs ps migrate seed test test-e2e eval lint typecheck build security \
        backup restore-drill prod-deploy approve-user dev-account reset dev-ca notices

define pending
	@echo "$@: $(1)'de uygulanır" >&2; exit 2
endef

help: ## Hedefleri ve değişkenleri listeler
	@echo "E.D.A. Hukuk — make hedefleri"
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{ printf "  %-14s %s\n", $$1, $$2 }'
	@echo
	@echo "Değişkenler: ENV TAG PROFILES HOT WATCH LLM EMBED BATCH SUITE KEEP SYSTEM S AFFECTED KIND REPO_DIR"

setup: ## Araç kontrolü, env dosyası, araç imajı, bağımlılıklar, sırlar ve git kancaları (idempotent)
	@command -v docker >/dev/null || { echo "setup: docker bulunamadı" >&2; exit 2; }
	@docker info >/dev/null 2>&1 || { echo "setup: Docker daemon erişilemiyor" >&2; exit 2; }
	@docker compose version --short | grep -qE '^5\.' || { echo "setup: docker compose v5 gerekli" >&2; exit 2; }
	@command -v git >/dev/null || { echo "setup: git bulunamadı" >&2; exit 2; }
	@test -f infra/compose/env/dev.env || cp infra/compose/env/dev.env.example infra/compose/env/dev.env
	@test -f infra/compose/env/test.env || cp infra/compose/env/test.env.example infra/compose/env/test.env
	@docker volume inspect eda-pnpm-store >/dev/null 2>&1 || docker volume create eda-pnpm-store >/dev/null
	$(TOOLS) pnpm install --frozen-lockfile
	$(TOOLS) bash infra/scripts/dev/gen-dev-secrets.sh
	git config core.hooksPath .husky

secrets: ## Dev sırlarını üretir (infra/secrets/dev; FORCE=1 üretilenleri yeniler)
	$(TOOLS) env FORCE=$${FORCE:-0} bash infra/scripts/dev/gen-dev-secrets.sh

dev: secrets ## Dev yığınını başlatır (HOT=1, WATCH=0, LLM=real, EMBED=tei, PROFILES="docs av")
	HOT=$(HOT) WATCH=$(WATCH) LLM=$(LLM) EMBED=$(EMBED) BATCH=$(BATCH) PROFILES="$(PROFILES)" \
	  infra/scripts/dev/dev-up.sh

down: ## Dev ve test yığınlarını durdurur (birimler korunur)
	COMPOSE_PROFILES=core,admin,mcp,ai,docs,av,hot $(DEV) down --remove-orphans
	@COMPOSE_PROFILES=core,docs,mcp,admin,av,test infra/scripts/dev/dc.sh test down --remove-orphans >/dev/null 2>&1 || true

logs: ## Servis günlüklerini izler (S=api)
	$(DEV) logs -f --tail=100 $(S)

ps: ## Servis durumlarını ve kaynak özetini gösterir
	$(DEV) ps -a --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
	@ids="$$($(DEV) ps -q)"; [ -z "$$ids" ] || \
	  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' $$ids

migrate: ## Veritabanı migrasyonlarını uygular
	$(DEV) run --rm --build migrate

seed: ## Dev örnek verisini yükler (yalnız dev; FORCE=1 --force)
	$(DEV) run --rm --build -e SEED_PROFILE=dev migrate node dist/bin/seed.js $(if $(filter 1,$(FORCE)),--force)

test: ## Birim + veritabanı entegrasyon testleri (TEST yığını: postgres -> migrate -> Vitest); AFFECTED=1 yalnız etkilenen paketler
	RUN_TOOL_ENV="TURBO_SCM_BASE TURBO_SCM_HEAD" $(TURBO) test $(if $(filter 1,$(AFFECTED)),--affected)
	$(DOCENGINE) test
	KEEP=$(KEEP) $(TESTDB)

test-e2e: secrets ## Playwright + axe uçtan uca testleri ve ağ izolasyonu
	@status=0; \
	trap 'COMPOSE_PROFILES=core,docs,mcp,admin,av,test infra/scripts/dev/dc.sh test down -v --remove-orphans >/dev/null 2>&1 || true' EXIT; \
	COMPOSE_PROFILES=core,docs,mcp,admin,av,test CLAMAV_ENABLED=true infra/scripts/dev/dc.sh test up -d --wait || status=$$?; \
	[ $$status -ne 0 ] || infra/scripts/ci/test-isolation.sh || status=$$?; \
	[ $$status -ne 0 ] || infra/scripts/dev/dc.sh test exec -T test-runner pnpm --filter @eda/e2e exec playwright test || status=$$?; \
	exit $$status

eval: ## Eval kümelerini koşar (SUITE=fast)
	@echo "eval: P08'de uygulanır" >&2; exit 2

lint: ## Biome, dependency-cruiser, Y kuralları, yasaklı ifade, iş akışı, kiracı bağı ve repo denetimleri, ruff
	$(TOOLS) pnpm lint
	$(TOOLS) node packages/db/scripts/check-migrations.ts
	$(TOOLS) bash infra/scripts/ci/check-tenant-binding.sh
	$(TOOLS) node packages/ui/scripts/gen-tokens.ts --check
	$(TOOLS) node packages/ui/scripts/check-ui-tokens.mjs
	$(TOOLS) node packages/ui/scripts/check-font-glyphs.mjs
	$(DEV) config -q
	infra/scripts/dev/dc.sh test config -q
	infra/scripts/dev/render-compose.sh
	$(DOCENGINE) lint

typecheck: ## TypeScript ve mypy tip denetimi
	$(TOOLS) pnpm exec tsc --noEmit -p tsconfig.json
	$(TURBO) typecheck
	$(DOCENGINE) typecheck

build: ## Uygulama paketlerini derler ve compose katmanlarını doğrular
	$(TURBO) build
	EDA_TAG=$(TAG) $(DEV) build
	$(DEV) config -q
	infra/scripts/dev/dc.sh test config -q
	infra/scripts/dev/render-compose.sh

security: ## Yerel güvenlik kapıları: audit, osv, gitleaks, iş akışı lint, shellcheck, Y kuralları, egress, kiracı bağı, sertleştirme (docker, ağ)
	bash infra/scripts/ci/security-local.sh

notices: ## THIRD_PARTY_NOTICES.md bölüm 1-2'yi yeniden üretir
	@mkdir -p .tmp
	$(DOCENGINE) licenses > .tmp/py-licenses.json
	$(CI)/gen-notices.ts --python .tmp/py-licenses.json

backup: ## Üretim yedeği (yalnız sunucu rolünde; ENV=prod|beta|staging KIND=full|incr|init)
	@test -f /etc/eda/host-role || { echo "backup: /etc/eda/host-role bulunamadı (çıkış 4)"; exit 4; }
	@case "$(ENV)" in prod|beta|staging) ;; *) echo "backup: ENV=prod|beta|staging olmalı (çıkış 4)" >&2; exit 4 ;; esac
	@test "$$(cat /etc/eda/host-role)" = "$(ENV)" || { echo "backup: host-role ENV=$(ENV) ile uyuşmuyor (çıkış 4)" >&2; exit 4; }
	infra/scripts/backup-exec.sh "$(ENV)" "$(or $(KIND),full)"

restore-drill: ## Geri yükleme tatbikatı (yalnız DR sunucusu; REPO_DIR=<pgBackRest repo dizini> [CIPHER_PASS_FILE REPORT ESCROW_FILE ESCROW_PASS_FILE KEK_FILE])
	@test -f /etc/eda/host-role || { echo "restore-drill: /etc/eda/host-role bulunamadı (çıkış 4)"; exit 4; }
	@test "$$(cat /etc/eda/host-role)" = dr || { echo "restore-drill: host-role dr olmalı (çıkış 4)" >&2; exit 4; }
	@test -n "$(REPO_DIR)" || { echo "restore-drill: REPO_DIR=<pgBackRest repo dizini> gerekli" >&2; exit 2; }
	infra/scripts/restore-drill.sh --repo-dir "$(REPO_DIR)" \
	  $(if $(CIPHER_PASS_FILE),--cipher-pass-file "$(CIPHER_PASS_FILE)") $(if $(REPORT),--report "$(REPORT)") \
	  $(if $(ESCROW_FILE),--escrow-file "$(ESCROW_FILE)" --escrow-pass-file "$(ESCROW_PASS_FILE)") $(if $(KEK_FILE),--kek-file "$(KEK_FILE)")

prod-deploy: ## İmzalı sürüm dağıtımı (TAG=<kısa SHA>)
	@test -f /etc/eda/host-role || { echo "prod-deploy: /etc/eda/host-role bulunamadı (çıkış 4)"; exit 4; }
	$(call pending,P33)

# olan AYRILMIŞ sunucuda koşar, dev/test yığını varken reddeder. Ajan/CI çalıştırmaz. DRY=1 komutları yazdırır, çalıştırmaz.
# GNU make'in yerleşik `AS` (assembler) varsayılanı personel e-postası sayılmaz (yalnız komut satırı/env).
approve-user: ## Meslek başvurusunu onaylar (EMAIL=<e-posta>, AS=<personel e-postası> isteğe bağlı; yalnız dev, api çalışırken)
	@test -n "$(EMAIL)" || { echo "approve-user: EMAIL=<e-posta> gerekli" >&2; exit 2; }
	$(DEV) exec -T api node dist/cli.js approve-user --email "$(EMAIL)" $(if $(filter command line environment,$(origin AS)),$(if $(AS),--as "$(AS)"))

dev-account: ## Dev hesabı kurar: kayıt, doğrulama, başvuru, onay (EMAIL=<e-posta> DEV_ACCOUNT_PASSWORD=<parola> [TOTP=1]; yalnız dev)
	@test -n "$(EMAIL)" || { echo "dev-account: EMAIL=<e-posta> gerekli" >&2; exit 2; }
	@test -n "$$DEV_ACCOUNT_PASSWORD" || { echo "dev-account: DEV_ACCOUNT_PASSWORD ortam değişkeni gerekli" >&2; exit 2; }
	DEV_ACCOUNT_EMAIL="$(EMAIL)" DEV_ACCOUNT_TOTP="$(TOTP)" node infra/scripts/dev/dev-account.mjs

reset: ## Dev yığınını ve birimlerini siler (yalnız dev; CONFIRM=1)
	@test "$(ENV)" = dev || { echo "reset: yalnız ENV=dev" >&2; exit 4; }
	@test "$(CONFIRM)" = 1 || { echo "reset: veritabanı, nesne deposu ve Caddy CA silinir; onay için CONFIRM=1" >&2; exit 2; }
	COMPOSE_PROFILES=core,admin,mcp,ai,docs,av,hot $(DEV) down --remove-orphans --volumes

dev-ca: ## Caddy yerel CA kök sertifikasını infra/secrets/dev/caddy-local-root.crt'ye yazar
	$(DEV) cp caddy:/data/caddy/pki/authorities/local/root.crt infra/secrets/dev/caddy-local-root.crt
	@chmod 0644 infra/secrets/dev/caddy-local-root.crt
	@echo "Yerel CA: infra/secrets/dev/caddy-local-root.crt (işletim sistemi/tarayıcı güven deposuna ekleme: 071 §5.2)"
