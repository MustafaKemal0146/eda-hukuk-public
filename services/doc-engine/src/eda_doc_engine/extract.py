"""Metin çıkarma (033 §7.4 `extract` aşaması; P21 dosyayla sohbet ilk dilimi, AS-0412).

Alt süreçte koşar (`sandbox/child.py` `extract` görevi); girdi baytları iş dizinindeki sabit adlı
dosyadadır. Yalnız mevcut bağımlılıklar kullanılır: PDF `pypdf`, DOCX `python-docx` (lxml). OCR,
Docling yapı çıkarımı ve türevler bu dilimde YOKTUR: metin katmanı olmayan PDF `hasTextLayer=false`
döner (worker evrakı `ocr_skipped` yapar). Gizli içerik (DOCX gizli sözcük, izlenen silme, yorum)
metne GİRMEZ ve raporlanır; PDF gizli metin sezimi bu dilimde yoktur (rapor boş, AS-0412).
Çıktıda ve günlükte belge içeriği yalnız `text` ve rapor `excerpt` alanındadır.
"""

import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from typing import Any, Final

from eda_doc_engine import __version__, limits

EXTRACTOR_VERSION: Final = f"eda-extract/{__version__}"

_W: Final = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
# Sekme ve satır sonu dışındaki denetim karakterleri ile görünmez biçim karakterleri atılır.
_CONTROL: Final = re.compile(r"[\u0000-\u0008\u000b-\u001f\u007f-\u009f]")
_INVISIBLE: Final = re.compile(r"[​-‏‪-‮⁠-⁤⁦-⁩﻿]")
_FALSE: Final = frozenset({"0", "false", "off"})


class Rejected(Exception):
    """Girdi yapısal olarak reddedildi (`rejectReason` kümesi)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(slots=True)
class _Hidden:
    items: list[dict[str, object]] = field(default_factory=list)

    def add(self, kind: str, text: str, page: int | None = None) -> None:
        if not text.strip():
            return
        self.items.append(
            {"kind": kind, "page": page, "charCount": len(text), "excerpt": clean(text)[:200]}
        )


def clean(text: str) -> str:
    """NFC, denetim ve görünmez karakter temizliği; satır sonları korunur."""
    text = unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))
    return _INVISIBLE.sub("", _CONTROL.sub("", text))


def _cap(text: str) -> tuple[str, bool]:
    raw = text.encode("utf-8")
    if len(raw) <= limits.EXTRACT_MAX_TEXT_BYTES:
        return text, False
    return raw[: limits.EXTRACT_MAX_TEXT_BYTES].decode("utf-8", errors="ignore"), True


def _result(
    file_type: str,
    *,
    text: str = "",
    page_count: int | None = None,
    has_text: bool = False,
    offsets: list[int] | None = None,
    hidden: _Hidden | None = None,
    reject: str | None = None,
) -> dict[str, object]:
    capped, truncated = _cap(text)
    items = hidden.items if hidden is not None else []
    return {
        "ok": True,
        "result": {
            "verdict": "reject" if reject is not None else "ok",
            "rejectReason": reject,
            "fileType": file_type,
            "pageCount": page_count,
            "hasTextLayer": has_text,
            "text": capped if reject is None else "",
            "textTruncated": truncated if reject is None else False,
            "pageOffsets": [o for o in (offsets or []) if o <= len(capped)],
            "hiddenContent": {
                "found": len(items) > 0,
                "excludedFromText": len(items) > 0,
                "items": items[: limits.EXTRACT_MAX_HIDDEN_ITEMS],
            },
            "extractorVersion": EXTRACTOR_VERSION,
        },
    }


# ---------------------------------------------------------------- PDF


def extract_pdf(data: bytes, max_pages: int) -> dict[str, object]:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            # Boş kullanıcı parolasıyla açılamayan PDF şifrelidir; parola istenmez.
            try:
                opened = bool(reader.decrypt(""))
            except Exception:
                opened = False
            if not opened:
                return _result("pdf", reject="encrypted_pdf")
        pages = reader.pages
        count = len(pages)
        if count > max_pages:
            return _result("pdf", page_count=count, reject="page_limit")
        parts: list[str] = []
        offsets: list[int] = []
        at = 0
        visible = 0
        for page in pages:
            page_text = clean(page.extract_text() or "").strip("\n")
            offsets.append(at)
            parts.append(page_text)
            at += len(page_text) + 2
            visible += sum(1 for ch in page_text if not ch.isspace())
    except PdfReadError:
        return _result("pdf", reject="corrupt")
    except ValueError, KeyError, TypeError, IndexError, AttributeError, RecursionError:
        return _result("pdf", reject="corrupt")
    has_text = count > 0 and visible >= limits.EXTRACT_MIN_TEXT_CHARS_PER_PAGE * count
    if not has_text:
        return _result("pdf", page_count=count, has_text=False)
    return _result("pdf", text="\n\n".join(parts), page_count=count, has_text=True, offsets=offsets)


# ---------------------------------------------------------------- DOCX


def _zip_guard(zf: zipfile.ZipFile, total_size: int) -> None:
    infos = zf.infolist()
    if len(infos) > limits.ZIP_MAX_ENTRIES:
        raise Rejected("zip_bomb")
    uncompressed = 0
    for info in infos:
        name = info.filename
        if name.startswith(("/", "\\")) or ".." in name.replace("\\", "/").split("/"):
            raise Rejected("zip_slip")
        uncompressed += info.file_size
        if info.file_size > limits.DOCX_MAX_PART_BYTES:
            raise Rejected("zip_bomb")
    if uncompressed > limits.ZIP_MAX_UNCOMPRESSED_BYTES:
        raise Rejected("zip_bomb")
    if total_size > 0 and uncompressed / total_size > limits.ZIP_MAX_RATIO:
        raise Rejected("zip_bomb")
    names = {i.filename for i in infos}
    if "word/document.xml" not in names:
        raise Rejected("unsupported_structure")
    if any(n.lower().endswith("vbaproject.bin") for n in names):
        raise Rejected("macro_detected")
    for n in names:
        if n.endswith(".xml") or n.endswith(".rels"):
            head = zf.read(n)
            if b"<!DOCTYPE" in head or b"<!ENTITY" in head:
                raise Rejected("xxe_blocked")


def _hidden_run(run: Any) -> bool:
    rpr = run.find(f"{_W}rPr")
    if rpr is None:
        return False
    for tag in ("vanish", "specVanish", "webHidden"):
        el = rpr.find(f"{_W}{tag}")
        if el is not None and str(el.get(f"{_W}val", "true")).lower() not in _FALSE:
            return True
    return False


def _run_text(run: Any) -> str:
    out: list[str] = []
    for child in run:
        tag = child.tag
        if tag == f"{_W}t":
            out.append(child.text or "")
        elif tag == f"{_W}tab":
            out.append("\t")
        elif tag in (f"{_W}br", f"{_W}cr"):
            out.append("\n")
    return "".join(out)


def _paragraph(p: Any, hidden: _Hidden) -> str:
    out: list[str] = []
    for run in p.iter(f"{_W}r"):
        # İzlenen silme (`w:del`) metni `w:delText`'tir; `w:t` toplanmadığı için metne girmez.
        if _hidden_run(run):
            hidden.add("docx_hidden_run", _run_text(run))
            continue
        out.append(_run_text(run))
    for deleted in p.iter(f"{_W}delText"):
        hidden.add("docx_tracked_deletion", deleted.text or "")
    return "".join(out)


def _block_text(el: Any, hidden: _Hidden) -> list[str]:
    tag = el.tag
    if tag == f"{_W}p":
        return [_paragraph(el, hidden)]
    if tag == f"{_W}tbl":
        rows: list[str] = []
        for tr in el.iter(f"{_W}tr"):
            cells = []
            for tc in tr.findall(f"{_W}tc"):
                cells.append(" ".join(_paragraph(p, hidden) for p in tc.iter(f"{_W}p")).strip())
            rows.append(" | ".join(cells))
        return rows
    if tag == f"{_W}sdt":
        content = el.find(f"{_W}sdtContent")
        return [] if content is None else [t for c in content for t in _block_text(c, hidden)]
    return []


def extract_docx(data: bytes) -> dict[str, object]:
    from docx import Document
    from docx.opc.exceptions import PackageNotFoundError

    hidden = _Hidden()
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            _zip_guard(zf, len(data))
            if "word/comments.xml" in zf.namelist():
                hidden.add("docx_comment", _comment_text(zf.read("word/comments.xml")))
        document = Document(io.BytesIO(data))
        body = document.element.body
        lines: list[str] = []
        for block in body:
            lines.extend(_block_text(block, hidden))
    except Rejected as r:
        return _result("docx", reject=r.reason)
    except zipfile.BadZipFile, PackageNotFoundError, KeyError, ValueError:
        return _result("docx", reject="corrupt")
    text = clean("\n".join(lines)).strip()
    return _result("docx", text=text, has_text=text != "", hidden=hidden)


def _comment_text(xml: bytes) -> str:
    import defusedxml.ElementTree as SafeET

    root = SafeET.fromstring(xml)
    return " ".join(t.text or "" for t in root.iter(f"{_W}t"))


# ---------------------------------------------------------------- TXT


def extract_txt(data: bytes) -> dict[str, object]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1254", errors="replace")
    text = clean(text).strip()
    return _result("txt", text=text, has_text=text != "")


def extract_bytes(data: bytes, file_type: str, max_pages: int) -> dict[str, object]:
    if file_type == "pdf":
        return extract_pdf(data, max_pages)
    if file_type == "docx":
        return extract_docx(data)
    if file_type == "txt":
        return extract_txt(data)
    return _result("txt", reject="unsupported_structure")
