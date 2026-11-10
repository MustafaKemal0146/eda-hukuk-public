#!/usr/bin/env bash
# doc-engine Python araçlarını konteynırda koşar; host'ta Python/uv gerekmez (013 §17.4).
# Kullanım: doc-engine-run.sh <lint|typecheck|test|gen-schemas|openapi|lock|licenses|l6>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly REPO_ROOT
readonly IMAGE="eda-doc-engine-dev:local"
readonly DOCKERFILE="$REPO_ROOT/infra/docker/python-service.Dockerfile"
readonly SVC="/workspace/services/doc-engine"
readonly GEN_IN="/workspace/packages/contracts/generated/json-schema"
readonly GEN_OUT="$SVC/src/eda_doc_engine/models/generated"

cmd="${1:-}"

if [[ "$cmd" == "l6" ]]; then
  shift
  exec bash "$REPO_ROOT/infra/scripts/dev/doc-engine-l6.sh" "$@"
fi

run() {
  docker run --rm --network "${NETWORK:-none}" \
    -u "$(id -u):$(id -g)" \
    -e HOME=/tmp -e RUFF_CACHE_DIR=/tmp/ruff -e MYPY_CACHE_DIR=/tmp/mypy -e UV_CACHE_DIR=/tmp/uv \
    -v "$REPO_ROOT:/workspace" -w "$SVC" \
    "$IMAGE" sh -c "$1"
}

if [[ "$cmd" == "lock" ]]; then
  docker build -q --target base -t eda-doc-engine-base:local -f "$DOCKERFILE" "$REPO_ROOT" >/dev/null
  exec docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e UV_CACHE_DIR=/tmp/uv \
    -v "$REPO_ROOT:/workspace" -w /workspace eda-doc-engine-base:local uv lock
fi

if [[ "$cmd" == "licenses" ]]; then
  # Üretim bağımlılıklarının ad/sürüm/lisans listesi (JSON); gen-notices.ts bölüm 2 girdisi.
  docker build -q --target deps -t eda-doc-engine-deps:local -f "$DOCKERFILE" "$REPO_ROOT" >/dev/null
  exec docker run --rm --network none eda-doc-engine-deps:local python -c '
import json, importlib.metadata as m
out = []
for d in m.distributions():
    meta = d.metadata
    lic = meta.get("License-Expression") or ""
    if not lic:
        cls = [c.split(" :: ")[-1] for c in (meta.get_all("Classifier") or []) if c.startswith("License ::")]
        lic = " OR ".join(cls) or (meta.get("License") or "UNKNOWN").splitlines()[0]
    lic = {
        "MIT License": "MIT",
        "Apache Software License": "Apache-2.0",
        "Python Software Foundation License": "PSF-2.0",
    }.get(lic, lic)
    out.append({"name": meta["Name"].lower(), "version": d.version, "license": lic})
print(json.dumps(sorted(out, key=lambda x: x["name"]), indent=2))
'
fi

docker build -q --target dev -t "$IMAGE" -f "$DOCKERFILE" "$REPO_ROOT" >/dev/null

case "$cmd" in
  lint) run "ruff check src tests scripts && ruff format --check src tests scripts" ;;
  typecheck) run "mypy src" ;;
  test) run "pytest -q" ;;
  gen-schemas)
    run "datamodel-codegen --input $GEN_IN --input-file-type jsonschema \
      --output-model-type pydantic_v2.BaseModel --output $GEN_OUT \
      --disable-timestamp --use-annotated --field-constraints --use-double-quotes \
      --target-python-version 3.14 --formatters builtin \
      && ruff format --quiet $GEN_OUT \
      && PYTHONPATH=src python scripts/gen_openapi.py"
    ;;
  openapi) run "PYTHONPATH=src python scripts/gen_openapi.py" ;;
  *)
    echo "kullanım: $0 <lint|typecheck|test|gen-schemas|openapi|lock|licenses|l6>" >&2
    exit 2
    ;;
esac
