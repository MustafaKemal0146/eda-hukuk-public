"""PDF ardıl denetimleri (084 §6 "Ardıl kontroller"; alt süreçte koşar).

A4 +/- 0,5 pt, sayfa sayısı > 0, gömülü yazı tipleri arasında Liberation Serif, boyut tavanı;
aksi `ExportFailed`. Meta veri: başlık = belge başlığı, yazar boş (gerekirse yeniden yazılır).
Ayrıştırıcı pypdf'tir (BSD-3-Clause); pikepdf'in Pillow bağımlılığı izin listesinde değildir
(AS-0295).
"""

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PyPdfError
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, PdfObject, TextStringObject

from eda_doc_engine.errors import ExportFailed
from eda_doc_engine.limits import PDF_MAX_BYTES, PDF_PAGE_SIZE_TOLERANCE_PT
from eda_doc_engine.typography import PAGE_HEIGHT_PT, PAGE_WIDTH_PT, PDF_FONT_POSTSCRIPT

_EMBED_KEYS: Final = ("/FontFile", "/FontFile2", "/FontFile3")
_MAX_XOBJECT_DEPTH: Final = 2


@dataclass(frozen=True, slots=True)
class PdfFacts:
    page_count: int
    page_sizes: list[tuple[float, float]]
    fonts: dict[str, bool]  # alt küme öneki atılmış PostScript adı -> gömülü mü
    title: str | None
    author: str | None


def _resolve(obj: PdfObject | None) -> PdfObject | None:
    return obj.get_object() if obj is not None else None


def _font_embedded(font: DictionaryObject) -> bool:
    desc = _resolve(font.get("/FontDescriptor"))
    if desc is None and "/DescendantFonts" in font:
        descendants = _resolve(font["/DescendantFonts"])
        if isinstance(descendants, ArrayObject) and descendants:
            child = _resolve(descendants[0])
            if isinstance(child, DictionaryObject):
                desc = _resolve(child.get("/FontDescriptor"))
    return isinstance(desc, DictionaryObject) and any(k in desc for k in _EMBED_KEYS)


def _base_name(raw: str) -> str:
    name = raw.lstrip("/")
    prefix, sep, rest = name.partition("+")
    return rest if sep and len(prefix) == 6 and prefix.isupper() else name


def _collect_fonts(resources: PdfObject | None, out: dict[str, bool], depth: int) -> None:
    res = _resolve(resources)
    if not isinstance(res, DictionaryObject):
        return
    fonts = _resolve(res.get("/Font"))
    if isinstance(fonts, DictionaryObject):
        for ref in fonts.values():
            font = _resolve(ref)
            if isinstance(font, DictionaryObject):
                name = _base_name(str(font.get("/BaseFont", "")))
                out[name] = out.get(name, False) or _font_embedded(font)
    xobjects = _resolve(res.get("/XObject"))
    if isinstance(xobjects, DictionaryObject) and depth < _MAX_XOBJECT_DEPTH:
        for ref in xobjects.values():
            xobj = _resolve(ref)
            if isinstance(xobj, DictionaryObject) and xobj.get("/Subtype") == "/Form":
                _collect_fonts(xobj.get("/Resources"), out, depth + 1)


def inspect_pdf(data: bytes) -> PdfFacts:
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        sizes: list[tuple[float, float]] = []
        fonts: dict[str, bool] = {}
        for page in reader.pages:
            box = page.mediabox
            sizes.append((float(box.width), float(box.height)))
            _collect_fonts(page.get("/Resources"), fonts, 0)
        meta = reader.metadata
        title = meta.title if meta is not None else None
        author = meta.author if meta is not None else None
    except (PyPdfError, ValueError, KeyError, TypeError) as exc:
        raise ExportFailed from exc
    return PdfFacts(len(sizes), sizes, fonts, title, author)


def verify(facts: PdfFacts, size_bytes: int) -> None:
    if size_bytes > PDF_MAX_BYTES or facts.page_count <= 0:
        raise ExportFailed
    for width, height in facts.page_sizes:
        if (
            abs(width - PAGE_WIDTH_PT) > PDF_PAGE_SIZE_TOLERANCE_PT
            or abs(height - PAGE_HEIGHT_PT) > PDF_PAGE_SIZE_TOLERANCE_PT
        ):
            raise ExportFailed
    if not any(
        embedded and name.startswith(PDF_FONT_POSTSCRIPT) for name, embedded in facts.fonts.items()
    ):
        raise ExportFailed


def _rewrite_metadata(data: bytes, title: str) -> bytes:
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(data), strict=False))
    info = DictionaryObject()
    info[NameObject("/Title")] = TextStringObject(title)
    writer.metadata = info
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def check_pdf_bytes(data: bytes, title: str) -> tuple[bytes, int]:
    facts = inspect_pdf(data)
    verify(facts, len(data))
    if (facts.title or "") != title or (facts.author or "") != "":
        try:
            data = _rewrite_metadata(data, title)
        except (PyPdfError, ValueError, KeyError, TypeError) as exc:
            raise ExportFailed from exc
        facts = inspect_pdf(data)
        verify(facts, len(data))
    return data, facts.page_count


def check_pdf_file(src: Path, dst: Path, title: str) -> dict[str, object]:
    """Alt süreç görevi `pdfcheck`: `src` denetlenir, sonuç `dst`'ye yazılır."""
    try:
        data, pages = check_pdf_bytes(src.read_bytes(), title)
    except ExportFailed:
        return {"ok": False, "code": ExportFailed.code}
    dst.write_bytes(data)
    return {"ok": True, "pageCount": pages}
