"""Gotenberg istemcisi sözleşme testleri (sahte taşıyıcı) ve PDF ardıl denetimleri
(084 §6; KK-P19a-13, KK-P19a-14). Gerçek Gotenberg ölçümleri `tests/l6/`. @tk TK-15"""

import asyncio

import httpx2
import pytest
from pdf_fixtures import make_pdf

from eda_doc_engine.errors import ExportFailed
from eda_doc_engine.pdf import checks, gotenberg
from eda_doc_engine.pdf.checks import check_pdf_bytes, inspect_pdf
from eda_doc_engine.pdf.gotenberg import GotenbergClient

DOCX = b"PK\x03\x04sahte-docx"


class FakeGotenberg:
    def __init__(self, pdf: bytes, status: int = 200) -> None:
        self.pdf = pdf
        self.status = status
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        if request.url.path == "/version":
            return httpx2.Response(200, text="8.37.0\n")
        return httpx2.Response(self.status, content=self.pdf)


def client(fake: FakeGotenberg) -> GotenbergClient:
    return GotenbergClient("http://gotenberg:3000", transport=httpx2.MockTransport(fake))


def test_kk_p19a_14_only_libreoffice_route_with_explicit_options() -> None:
    fake = FakeGotenberg(make_pdf())
    pdf = asyncio.run(client(fake).convert_docx(DOCX))
    assert pdf.startswith(b"%PDF")
    (req,) = fake.requests
    assert req.method == "POST"
    assert str(req.url) == "http://gotenberg:3000/forms/libreoffice/convert"
    body = req.read()
    for name, value in [
        ("landscape", "false"),
        ("exportFormFields", "false"),
        ("exportBookmarks", "false"),
        ("exportNotes", "false"),
        ("pdfua", "false"),
    ]:
        assert f'name="{name}"\r\n\r\n{value}\r\n'.encode() in body
    assert b'name="files"; filename="document.docx"' in body
    assert DOCX in body
    for forbidden in (b"pdfa", b"downloadFrom", b"url", b"Gotenberg-Webhook"):
        assert forbidden not in body
    assert not any(h.lower().startswith("gotenberg-webhook") for h in req.headers)
    assert "chromium" not in str(req.url)


def test_kk_p19a_14_client_ignores_environment_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.setenv("ALL_PROXY", "http://127.0.0.1:9")
    c = GotenbergClient("http://gotenberg:3000")
    inner = c._client()
    assert inner._trust_env is False
    assert inner.follow_redirects is False


def test_kk_p19a_13_gotenberg_errors_are_export_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ExportFailed):
        asyncio.run(client(FakeGotenberg(b"", status=500)).convert_docx(DOCX))
    monkeypatch.setattr(gotenberg, "PDF_MAX_BYTES", 10)
    with pytest.raises(ExportFailed):
        asyncio.run(client(FakeGotenberg(make_pdf())).convert_docx(DOCX))

    def refuse(_request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("bağlantı yok")

    broken = GotenbergClient("http://gotenberg:3000", transport=httpx2.MockTransport(refuse))
    with pytest.raises(ExportFailed):
        asyncio.run(broken.convert_docx(DOCX))
    assert asyncio.run(broken.version()) is None


def test_kk_p19a_13_version_is_cached() -> None:
    fake = FakeGotenberg(make_pdf())
    c = client(fake)
    assert asyncio.run(c.version()) == "8.37.0"
    assert asyncio.run(c.version()) == "8.37.0"
    assert len(fake.requests) == 1


def test_kk_p19a_13_post_checks_accept_a4_with_embedded_liberation() -> None:
    data, pages = check_pdf_bytes(make_pdf(title="Örnek"), "Örnek")
    assert pages == 2
    facts = inspect_pdf(data)
    assert facts.fonts == {"LiberationSerif": True}
    assert facts.page_sizes[0] == pytest.approx((595.30, 841.89), abs=0.01)


@pytest.mark.parametrize(
    "pdf",
    [
        make_pdf(width=612, height=792),  # Letter
        make_pdf(width=595.28, height=842.5),  # 0,5 pt dışı
        make_pdf(font="BAAAAA+DejaVuSerif"),
        make_pdf(embedded=False),
        b"%PDF-1.7 bozuk",
    ],
)
def test_kk_p19a_13_post_checks_reject(pdf: bytes) -> None:
    with pytest.raises(ExportFailed):
        check_pdf_bytes(pdf, "Örnek")


def test_kk_p19a_13_post_checks_size_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(checks, "PDF_MAX_BYTES", 100)
    with pytest.raises(ExportFailed):
        check_pdf_bytes(make_pdf(), "Örnek")


def test_kk_p19a_13_metadata_title_set_author_empty() -> None:
    data, _ = check_pdf_bytes(make_pdf(title="Başka", author="Biri"), "Örnek dilekçe")
    facts = inspect_pdf(data)
    assert facts.title == "Örnek dilekçe"
    assert facts.author in (None, "")
