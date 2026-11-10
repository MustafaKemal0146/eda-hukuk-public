"""Env okuma noktası (002 §5.7). Eksik, biçimsiz veya bilinmeyen değişkende servis başlamaz.

Sınır ve zaman aşımı sabitleri env değildir (`limits.py`). Sır değeri yalnız dosyadan okunur
(`DOC_ENGINE_TOKEN_FILE`); değer ne loglanır ne de hata mesajına yazılır.
"""

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final
from urllib.parse import urlsplit

KNOWN_VARS: Final = (
    "DOC_ENGINE_PORT",
    "DOC_ENGINE_TOKEN_FILE",
    "GOTENBERG_URL",
    "OCR_LANGS",
    "MAX_UPLOAD_MB",
    "MAX_PAGES",
    "OCR_BATCH_PAGES",
    "DOCLING_ARTIFACTS_PATH",
    "HF_HUB_OFFLINE",
    "DOC_ENGINE_CONCURRENCY",
    "SUBPROCESS_TIMEOUT_SEC",
)
_OWN_PREFIX: Final = "DOC_ENGINE_"
_OCR_LANGS = re.compile(r"^[a-z]{3}(?:_[a-z]+)?(?:\+[a-z]{3}(?:_[a-z]+)?)*$")


class ConfigError(Exception):
    """Yapılandırma hatası; mesaj yalnız değişken adını içerir (değer içermez)."""


@dataclass(frozen=True, slots=True)
class Settings:
    port: int
    token_file: Path
    gotenberg_url: str
    ocr_langs: str
    max_upload_mb: int
    max_pages: int
    ocr_batch_pages: int
    docling_artifacts_path: Path
    hf_hub_offline: bool
    concurrency: int
    subprocess_timeout_sec: int

    @property
    def max_body_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


def _int(env: Mapping[str, str], name: str, low: int, high: int) -> int:
    raw = env[name]
    if not raw.isdigit():
        raise ConfigError(f"{name} tamsayı olmalı")
    value = int(raw)
    if not low <= value <= high:
        raise ConfigError(f"{name} {low}-{high} arası olmalı")
    return value


def _abs_path(env: Mapping[str, str], name: str) -> Path:
    path = Path(env[name])
    if not path.is_absolute():
        raise ConfigError(f"{name} mutlak yol olmalı")
    return path


def _gotenberg_url(raw: str) -> str:
    parts = urlsplit(raw)
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or parts.path not in ("", "/")
    ):
        raise ConfigError("GOTENBERG_URL http(s)://<host>:<port> biçiminde olmalı")
    return raw.rstrip("/")


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env
    missing = [name for name in KNOWN_VARS if not source.get(name)]
    if missing:
        raise ConfigError("eksik değişken: " + ", ".join(missing))
    unknown = sorted(k for k in source if k.startswith(_OWN_PREFIX) and k not in KNOWN_VARS)
    if unknown:
        raise ConfigError("bilinmeyen değişken: " + ", ".join(unknown))
    if not _OCR_LANGS.match(source["OCR_LANGS"]):
        raise ConfigError("OCR_LANGS biçimi tur+eng gibi olmalı")
    if source["HF_HUB_OFFLINE"] not in ("0", "1"):
        raise ConfigError("HF_HUB_OFFLINE 0 veya 1 olmalı")
    return Settings(
        port=_int(source, "DOC_ENGINE_PORT", 1, 65535),
        token_file=_abs_path(source, "DOC_ENGINE_TOKEN_FILE"),
        gotenberg_url=_gotenberg_url(source["GOTENBERG_URL"]),
        ocr_langs=source["OCR_LANGS"],
        max_upload_mb=_int(source, "MAX_UPLOAD_MB", 1, 1024),
        max_pages=_int(source, "MAX_PAGES", 1, 100_000),
        ocr_batch_pages=_int(source, "OCR_BATCH_PAGES", 1, 10_000),
        docling_artifacts_path=_abs_path(source, "DOCLING_ARTIFACTS_PATH"),
        hf_hub_offline=source["HF_HUB_OFFLINE"] == "1",
        concurrency=_int(source, "DOC_ENGINE_CONCURRENCY", 1, 64),
        subprocess_timeout_sec=_int(source, "SUBPROCESS_TIMEOUT_SEC", 1, 86_400),
    )
