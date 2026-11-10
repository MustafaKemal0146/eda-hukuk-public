"""Alt süreç girişi: önce `RLIMIT_*`, sonra sabit görev kümesinden biri (033 §7.5).

Görev adı yalnız `TASKS` içinden seçilir (keyfi modül yükleme yok). Girdi stdin'den, dosyalar yalnız
çalışma dizinindeki sabit adlardır; çıktı stdout'a tek JSON nesnesidir. stderr üst süreçte atılır.
"""

import json
import os
import resource
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Final

from eda_doc_engine import limits

RENDER_OUTPUT: Final = "render.out"
GOTENBERG_PDF: Final = "gotenberg.pdf"
EXPORT_PDF: Final = "export.pdf"
EXTRACT_INPUT: Final = "extract.in"

LIMITS: Final = (
    (resource.RLIMIT_AS, limits.RLIMIT_AS_BYTES),
    (resource.RLIMIT_CPU, limits.RLIMIT_CPU_SEC),
    (resource.RLIMIT_FSIZE, limits.RLIMIT_FSIZE_BYTES),
    (resource.RLIMIT_NOFILE, limits.RLIMIT_NOFILE),
    (resource.RLIMIT_NPROC, limits.RLIMIT_NPROC),
    (resource.RLIMIT_CORE, limits.RLIMIT_CORE),
)


def apply_limits() -> None:
    for kind, value in LIMITS:
        _soft, hard = resource.getrlimit(kind)
        cap = value if hard == resource.RLIM_INFINITY else min(value, hard)
        resource.setrlimit(kind, (cap, cap))


def _render(payload: bytes) -> dict[str, object]:
    from eda_doc_engine.export import render_document

    return render_document(payload, Path(RENDER_OUTPUT))


def _pdfcheck(payload: bytes) -> dict[str, object]:
    from eda_doc_engine.pdf.checks import check_pdf_file

    title = str(json.loads(payload)["title"])
    return check_pdf_file(Path(GOTENBERG_PDF), Path(EXPORT_PDF), title)


def _extract(payload: bytes) -> dict[str, object]:
    from eda_doc_engine.extract import extract_bytes

    request = json.loads(payload)
    return extract_bytes(
        Path(EXTRACT_INPUT).read_bytes(), str(request["fileType"]), int(request["maxPages"])
    )


def _probe(payload: bytes) -> dict[str, object]:
    """Tanı görevi: uygulanan sınırları ve ortam anahtarlarını döner; istenirse bekler (test)."""
    request = json.loads(payload or b"{}")
    sleep = float(request.get("sleepSec", 0))
    if sleep > 0:
        time.sleep(sleep)
    return {
        "ok": True,
        "limits": {str(kind): resource.getrlimit(kind)[0] for kind, _ in LIMITS},
        "cwd": str(Path.cwd()),
        "envKeys": sorted(os.environ),
    }


TASKS: Final[dict[str, Callable[[bytes], dict[str, object]]]] = {
    "render": _render,
    "pdfcheck": _pdfcheck,
    "extract": _extract,
    "probe": _probe,
}


def main(argv: list[str]) -> int:
    apply_limits()
    if len(argv) != 2 or argv[1] not in TASKS:
        return 2
    payload = sys.stdin.buffer.read()
    result = TASKS[argv[1]](payload)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
