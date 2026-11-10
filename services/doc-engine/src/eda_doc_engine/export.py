"""Dışa aktarım üretimi (alt süreçte koşar; 084 §7 davranış 1-2).

`udf`/`docx` doğrudan yazılır; `pdf` için aynı DOCX yazıcısının çıktısı üretilir ve Gotenberg'e
ana süreç gönderir (kullanıcı DOCX'i asla gönderilmez; 084 §6).
"""

from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from eda_doc_engine.docx.writer import DocxOptions, write_docx
from eda_doc_engine.errors import DocEngineFailure, InvalidDocAst
from eda_doc_engine.layout import build_layout
from eda_doc_engine.models.generated.export_schema import ExportRequest, Format
from eda_doc_engine.udf.writer import write_udf


def render_bytes(
    request: ExportRequest, now: datetime | None = None
) -> tuple[bytes, list[tuple[str, int]], str]:
    """DocAST -> (UDF | DOCX) baytları, bozulma listesi, temizlenmiş başlık.

    `fixedTimestamp` verilirse çıktı bayt-bayt deterministiktir (084 İ3, D8).
    """
    layout = build_layout(request.docAst)
    page_numbers = request.options.pageNumbers
    if request.format == Format.udf:
        data, degraded = write_udf(layout, page_numbers)
    else:
        fixed = request.options.fixedTimestamp
        stamp = fixed if fixed is not None else (now or datetime.now(UTC))
        data, degraded = write_docx(layout, DocxOptions(page_numbers=page_numbers, timestamp=stamp))
    return data, degraded.items(), layout.title


def render_document(payload: bytes, out: Path) -> dict[str, object]:
    """Alt süreç görevi `render`: çıktıyı `out`'a yazar, özet JSON döner (içerik taşımaz)."""
    try:
        request = ExportRequest.model_validate_json(payload)
        data, degraded, title = render_bytes(request)
    except ValidationError:
        return {"ok": False, "code": InvalidDocAst.code}
    except DocEngineFailure as failure:
        return {"ok": False, "code": failure.code}
    out.write_bytes(data)
    return {
        "ok": True,
        "degraded": [{"feature": f, "count": c} for f, c in degraded],
        "title": title,
    }
