"""`openapi.json` anlık görüntüsünü üretir (P19a.12). Çalışma zamanında OpenAPI yayımlanmaz.

Kullanım (konteynırda): `doc-engine-run.sh openapi`. `tests/test_openapi.py` farkı denetler.
"""

import json
import sys
from pathlib import Path

from eda_doc_engine.config import load_settings
from eda_doc_engine.main import create_app

OUT = Path(__file__).resolve().parents[1] / "openapi.json"
_ENV = {
    "DOC_ENGINE_PORT": "8002",
    "DOC_ENGINE_TOKEN_FILE": "/run/secrets/doc_engine_token",
    "GOTENBERG_URL": "http://gotenberg:3000",
    "OCR_LANGS": "tur+eng",
    "MAX_UPLOAD_MB": "50",
    "MAX_PAGES": "500",
    "OCR_BATCH_PAGES": "20",
    "DOCLING_ARTIFACTS_PATH": "/opt/models",
    "HF_HUB_OFFLINE": "1",
    "DOC_ENGINE_CONCURRENCY": "1",
    "SUBPROCESS_TIMEOUT_SEC": "300",
}


def render() -> str:
    app = create_app(load_settings(_ENV), token=b"x" * 32)
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    text = render()
    if "--check" in sys.argv:
        sys.exit(0 if OUT.read_text(encoding="utf-8") == text else 1)
    OUT.write_text(text, encoding="utf-8")
