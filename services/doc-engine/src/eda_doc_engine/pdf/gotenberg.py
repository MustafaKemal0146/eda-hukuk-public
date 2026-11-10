"""Gotenberg istemcisi: yalnız LibreOffice yolu (084 §6, 002 §5.9, 061 CTL-FILE-09).

- Tek uç `POST /forms/libreoffice/convert`; Chromium, URL'den indirme ve webhook yolları
  kullanılmaz.
- Girdi yalnız doc-engine'in ürettiği DOCX'tir (sabit ad `document.docx`).
- Yalnız açıkça ayarlanan seçenekler gönderilir: dikey yönelim; form alanı, yer imi ve not dışa
  aktarımı kapalı; PDF/UA kapalı; PDF/A alanı gönderilmez (kapalı). Alan adları Gotenberg 8.37.0'da
  doğrulandı (AS-0299).
- `trust_env=False`: ortamdaki vekil/sertifika ayarları devralınmaz; yönlendirme izlenmez.
- Yanıt `PDF_MAX_BYTES` + 1 baytta kesilir.
"""

from typing import Final

import httpx2

from eda_doc_engine.errors import ExportFailed
from eda_doc_engine.limits import GOTENBERG_TIMEOUT_SEC, PDF_MAX_BYTES

CONVERT_PATH: Final = "/forms/libreoffice/convert"
VERSION_PATH: Final = "/version"
DOCX_NAME: Final = "document.docx"
DOCX_MIME: Final = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FORM_FIELDS: Final[dict[str, str]] = {
    "landscape": "false",
    "exportFormFields": "false",
    "exportBookmarks": "false",
    "exportNotes": "false",
    "pdfua": "false",
}
_VERSION_MAX_BYTES: Final = 64


class GotenbergClient:
    def __init__(
        self,
        base_url: str,
        timeout_sec: float = GOTENBERG_TIMEOUT_SEC,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_sec
        self._transport = transport
        self._version: str | None = None

    def _client(self) -> httpx2.AsyncClient:
        return httpx2.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
            trust_env=False,
            follow_redirects=False,
            transport=self._transport,
        )

    async def convert_docx(self, docx: bytes) -> bytes:
        files = {"files": (DOCX_NAME, docx, DOCX_MIME)}
        try:
            async with self._client() as client:
                request = client.build_request("POST", CONVERT_PATH, data=FORM_FIELDS, files=files)
                response = await client.send(request, stream=True)
                try:
                    if response.status_code != 200:
                        raise ExportFailed
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > PDF_MAX_BYTES:
                            raise ExportFailed
                finally:
                    await response.aclose()
        except httpx2.HTTPError as exc:
            raise ExportFailed from exc
        return bytes(body)

    async def version(self) -> str | None:
        """Gotenberg sürümü (`GET /version`, düz metin); alınamazsa `None` (rapor alanı)."""
        if self._version is not None:
            return self._version
        try:
            async with self._client() as client:
                response = await client.get(VERSION_PATH)
        except httpx2.HTTPError:
            return None
        text = response.text.strip()
        if response.status_code != 200 or not text or len(text) > _VERSION_MAX_BYTES:
            return None
        self._version = text
        return text
