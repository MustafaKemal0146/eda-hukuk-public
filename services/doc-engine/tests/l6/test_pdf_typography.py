"""L6: DocAST -> DOCX -> Gotenberg -> PDF tipografi ölçümleri (084 §5.6, §9.5; KK-P19a-13, -14).

Yalnız `doc-engine-run.sh l6` ile (geçici iç ağ + sabit digest'li Gotenberg) koşar.
Veri sentetiktir.
@tk TK-15
"""

import asyncio
import io
import os
import socket
import statistics
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx2
import pytest
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer, LTTextLine
from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import itertools

from samples import doc, heading, para, petition, run, section, table

from eda_doc_engine.docx.writer import DocxOptions, write_docx
from eda_doc_engine.layout import build_layout
from eda_doc_engine.models.generated.docast_schema import DocAst
from eda_doc_engine.pdf.checks import check_pdf_bytes, inspect_pdf
from eda_doc_engine.pdf.gotenberg import GotenbergClient
from eda_doc_engine.typography import (
    MARGIN_BOTTOM_PT,
    MARGIN_LEFT_PT,
    MARGIN_RIGHT_PT,
    MARGIN_TOP_PT,
    PAGE_HEIGHT_PT,
    PAGE_WIDTH_PT,
    SINGLE_LINE_TWIP,
)

pytestmark = pytest.mark.l6

# 084 §9.5 madde 6: altın sayfa sayısı ilk onaylı çıktıdan kaydedildi (P19a, Gotenberg 8.37.0).
GOLDEN_PETITION_PAGES = 3
STAMP = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
HEADER = ["ÖRNEK HUKUK BÜROSU", "Örnek Mah. Örnek Cad. No: 1 Örnekşehir"]


@dataclass(frozen=True)
class Line:
    page: int
    text: str
    x0: float
    y0: float
    x1: float
    y1: float


def gotenberg_url() -> str:
    url = os.environ.get("GOTENBERG_URL")
    assert url, "GOTENBERG_URL yok: doc-engine-run.sh l6 ile koşun"
    return url


def to_pdf(d: dict[str, Any], page_numbers: bool = True, line_twip: int | None = None) -> bytes:
    layout = build_layout(DocAst.model_validate(d))
    opts = DocxOptions(page_numbers=page_numbers, timestamp=STAMP)
    if line_twip is not None:
        opts = DocxOptions(page_numbers=page_numbers, timestamp=STAMP, body_line_twip=line_twip)
    docx, _ = write_docx(layout, opts)
    return asyncio.run(GotenbergClient(gotenberg_url()).convert_docx(docx))


def lines(pdf: bytes) -> list[Line]:
    out: list[Line] = []
    for page_no, page in enumerate(extract_pages(io.BytesIO(pdf)), start=1):
        for box in page:
            if isinstance(box, LTTextContainer):
                for ln in box:
                    if isinstance(ln, LTTextLine) and ln.get_text().strip():
                        out.append(Line(page_no, ln.get_text().strip(), *ln.bbox))
    return out


def body_lines(all_lines: list[Line]) -> list[Line]:
    """Antet satırları ve alt bilgi sayfa numarası hariç."""
    return [
        ln
        for ln in all_lines
        if ln.text not in HEADER and not (ln.text.isdigit() and ln.y1 < float(MARGIN_BOTTOM_PT))
    ]


# ---------- 1, 2, 4, 6: sayfa kutusu, kenar boşlukları, yazı tipi, altın sayfa sayısı ----------


def test_kk_p19a_13_page_box_margins_font_and_golden_pages() -> None:
    pdf = to_pdf(petition(24))
    checked, pages = check_pdf_bytes(pdf, "Örnek dilekçe")
    facts = inspect_pdf(checked)
    assert pages == GOLDEN_PETITION_PAGES >= 3
    for w, h in facts.page_sizes:
        assert abs(w - PAGE_WIDTH_PT) <= 0.5
        assert abs(h - PAGE_HEIGHT_PT) <= 0.5
    assert any(n.startswith("LiberationSerif") and e for n, e in facts.fonts.items())
    body = body_lines(lines(pdf))
    assert body
    tol = 1.0
    for ln in body:
        assert ln.x0 >= float(MARGIN_LEFT_PT) - tol, ln
        assert ln.x1 <= PAGE_WIDTH_PT - float(MARGIN_RIGHT_PT) + tol, ln
        assert ln.y1 <= PAGE_HEIGHT_PT - float(MARGIN_TOP_PT) + tol, ln
        assert ln.y0 >= float(MARGIN_BOTTOM_PT) - tol, ln
    print(
        "L6 sayfa",
        facts.page_sizes[0],
        "metin kutusu",
        (
            min(ln.x0 for ln in body),
            min(ln.y0 for ln in body),
            max(ln.x1 for ln in body),
            max(ln.y1 for ln in body),
        ),
        "yazı tipleri",
        sorted(facts.fonts),
    )
    numbers = [ln.text for ln in lines(pdf) if ln.text.isdigit() and ln.y1 < 56.69]
    assert numbers == [str(i) for i in range(1, pages + 1)]  # alt bilgide yalnız "N"
    reader = PdfReader(io.BytesIO(checked))
    assert reader.metadata is not None
    assert reader.metadata.title == "Örnek dilekçe"
    assert not reader.metadata.author


# ---------- 3: satır aralığı oranı ----------


def _gaps(pdf: bytes) -> list[float]:
    by_page: dict[int, list[Line]] = {}
    for ln in body_lines(lines(pdf)):
        by_page.setdefault(ln.page, []).append(ln)
    gaps: list[float] = []
    for page_lines in by_page.values():
        ys = sorted((ln.y0 for ln in page_lines), reverse=True)
        gaps += [a - b for a, b in itertools.pairwise(ys) if 0 < a - b < 40]
    return gaps


def test_kk_p19a_13_line_spacing_ratio_one_and_half() -> None:
    text = " ".join(["Örnek gövde metni satır aralığı ölçümü için yazılmıştır."] * 40)
    d = doc([section("generic", [para(run(text))])])
    ratio = statistics.median(_gaps(to_pdf(d, False))) / statistics.median(
        _gaps(to_pdf(d, False, line_twip=SINGLE_LINE_TWIP))
    )
    print(f"L6 satır aralığı oranı={ratio:.4f}")
    assert abs(ratio - 1.5) <= 0.03, ratio


# ---------- 5: başlık sayfa sonunda kalmaz; imza bloğu tek başına kalmaz ----------


def _filler(n: int) -> list[dict[str, Any]]:
    return [para(run(f"Örnek dolgu satırı {i}."), indent="none") for i in range(n)]


def test_kk_p19a_13_no_page_ends_with_heading() -> None:
    """Dolgu sayısı taranır: başlık sayfa sonuna düşecek konumlar dahil (en az biri itilir)."""
    pushed = 0
    for filler in range(28, 42):
        d = doc(
            [
                section(
                    "generic",
                    [
                        *_filler(filler),
                        heading("ÖRNEK BAŞLIK"),
                        para(run("Başlığı izleyen örnek paragraf.")),
                    ],
                )
            ]
        )
        all_lines = body_lines(lines(to_pdf(d, False)))
        pages = sorted({ln.page for ln in all_lines})
        for page in pages[:-1]:
            on_page = [ln for ln in all_lines if ln.page == page]
            last = min(on_page, key=lambda ln: ln.y0)
            assert last.text != "ÖRNEK BAŞLIK", f"dolgu={filler}"
        head = next(ln for ln in all_lines if ln.text == "ÖRNEK BAŞLIK")
        follow = next(ln for ln in all_lines if ln.text.startswith("Başlığı izleyen"))
        assert head.page == follow.page, f"dolgu={filler}"
        if head.page > 1:
            pushed += 1
    assert pushed > 0  # sayfa sınırı gerçekten sınandı


def test_kk_p19a_13_signature_not_alone_on_page() -> None:
    """İmza bloğu bölünmez ve üstünde en az bir gövde satırı bulunur (keepNext zinciri)."""
    names = ("Davacı Vekili", "Av. Örnek Avukat", "İmza")
    moved = 0
    for filler in range(24, 38):
        d = doc(
            [
                section(
                    "resultAndRequest",
                    [*_filler(filler), para(run("01.01.2026"), align="right", indent="none")],
                ),
                section(
                    "attorneySignature",
                    [para(run(n), align="center", indent="none") for n in names],
                    layout="right_box",
                    box=70,
                    keep=True,
                ),
            ]
        )
        all_lines = body_lines(lines(to_pdf(d, False)))
        sig = [ln for ln in all_lines if ln.text in names]
        assert len(sig) == 3
        assert len({ln.page for ln in sig}) == 1, f"imza bölündü (dolgu={filler})"
        page = sig[0].page
        above = [
            ln
            for ln in all_lines
            if ln.page == page and ln not in sig and ln.y0 > max(s.y0 for s in sig)
        ]
        assert above, f"imza bloğu sayfada tek başına (dolgu={filler})"
        assert min(s.x0 for s in sig) >= float(MARGIN_LEFT_PT) + 95 * 72 / 25.4 - 1
        if page > 1:
            moved += 1
    assert moved > 0  # imza ikinci sayfaya geçen konumlar sınandı


def test_kk_p19a_13_long_table_header_repeats() -> None:
    rows = [["Sıra", "Açıklama"]] + [[str(i), f"Örnek kalem {i}"] for i in range(1, 80)]
    d = doc([section("generic", [table(rows, [30, 135])])])
    all_lines = body_lines(lines(to_pdf(d, False)))
    pages = sorted({ln.page for ln in all_lines})
    assert len(pages) >= 2
    for page in pages:
        assert any(ln.text.startswith("Sıra") for ln in all_lines if ln.page == page), page


# ---------- KK-P19a-14: ağ yalıtımı ve Gotenberg yüzeyi ----------


def test_kk_p19a_14_no_egress_from_docproc() -> None:
    # İç ağda dış yönlendirme ve DNS yoktur (çıkışsız `docproc` eşleniği).
    with pytest.raises((OSError, TimeoutError)) as connect:
        socket.create_connection(("1.1.1.1", 443), timeout=3)
    assert connect.value is not None
    with pytest.raises(socket.gaierror):
        socket.getaddrinfo("example.com", 443)


def test_kk_p19a_14_gotenberg_chromium_download_webhook_closed() -> None:
    url = gotenberg_url()
    with httpx2.Client(base_url=url, timeout=60, trust_env=False) as c:
        assert (
            c.post(
                "/forms/chromium/convert/url", data={"url": "http://example.invalid"}
            ).status_code
            == 404
        )
        assert (
            c.post(
                "/forms/chromium/convert/html",
                files={"files": ("index.html", b"<p>x</p>", "text/html")},
            ).status_code
            == 404
        )
        dl = c.post(
            "/forms/libreoffice/convert",
            files={"downloadFrom": (None, '[{"url":"http://gotenberg:3000/health"}]')},
        )
        assert dl.status_code == 400, dl.text
        docx, _ = write_docx(
            build_layout(DocAst.model_validate(petition(1))),
            DocxOptions(page_numbers=False, timestamp=STAMP),
        )
        hooked = c.post(
            "/forms/libreoffice/convert",
            headers={
                "Gotenberg-Webhook-Url": "http://example.invalid/hook",
                "Gotenberg-Webhook-Error-Url": "http://example.invalid/err",
            },
            files={"files": ("document.docx", docx, "application/octet-stream")},
        )
        # Webhook kapalı: istek eşzamanlı yanıtlanır, dış adrese gidilmez.
        assert hooked.status_code == 200
        assert hooked.content.startswith(b"%PDF")
        assert c.get("/version").text.strip() == "8.37.0"
