"""Ortak test yardımcıları. Veri sentetiktir; XML yalnız `defusedxml` ile ayrıştırılır."""

import io
import sys
import zipfile
from pathlib import Path
from typing import Any
from xml.etree.ElementTree import Element

import defusedxml.ElementTree as SafeET
import pytest

sys.path.insert(0, str(Path(__file__).parent))

from eda_doc_engine.config import Settings
from eda_doc_engine.export import render_bytes
from eda_doc_engine.models.generated.export_schema import ExportRequest

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
TOKEN = b"test-token-0123456789abcdefghijklmnopqrstuv"


def render(req: dict[str, Any]) -> tuple[bytes, dict[str, int], str]:
    data, degraded, title = render_bytes(ExportRequest.model_validate(req))
    return data, dict(degraded), title


def udf_xml(data: bytes) -> Element:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return SafeET.fromstring(zf.read("content.xml"))


def docx_part(data: bytes, name: str) -> Element:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return SafeET.fromstring(zf.read(name))


def docx_names(data: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return zf.namelist()


def pool_slice(pool: str, start: int, length: int) -> str:
    """UTF-16 kod birimi diliminden metin (084 §2.4)."""
    raw = pool.encode("utf-16-le")
    return raw[2 * start : 2 * (start + length)].decode("utf-16-le")


def settings(**over: Any) -> Settings:
    base: dict[str, Any] = {
        "port": 8002,
        "token_file": Path("/run/secrets/doc_engine_token"),
        "gotenberg_url": "http://gotenberg:3000",
        "ocr_langs": "tur+eng",
        "max_upload_mb": 50,
        "max_pages": 500,
        "ocr_batch_pages": 20,
        "docling_artifacts_path": Path("/opt/models"),
        "hf_hub_offline": True,
        "concurrency": 1,
        "subprocess_timeout_sec": 300,
    }
    base.update(over)
    return Settings(**base)


@pytest.fixture
def auth() -> dict[str, str]:
    return {"Authorization": "Bearer " + TOKEN.decode()}
