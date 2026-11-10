"""Bearer token doğrulaması (`DOC_ENGINE_TOKEN_FILE`; 033 §7.4).

Token açılışta dosyadan okunur; karşılaştırma sabit zamanlıdır (`hmac.compare_digest`). Token değeri
loglanmaz, hata mesajına yazılmaz.
"""

import hmac
from pathlib import Path
from typing import Final

from eda_doc_engine.config import ConfigError

_SCHEME: Final = "bearer"
_MIN_TOKEN_BYTES: Final = 32


def load_token(path: Path) -> bytes:
    try:
        token = path.read_bytes().strip()
    except OSError as exc:
        raise ConfigError("DOC_ENGINE_TOKEN_FILE okunamadı") from exc
    if len(token) < _MIN_TOKEN_BYTES:
        raise ConfigError("DOC_ENGINE_TOKEN_FILE çok kısa")
    return token


class BearerVerifier:
    def __init__(self, token: bytes) -> None:
        self._token = token

    def verify(self, authorization: str | None) -> bool:
        if not authorization:
            return False
        scheme, _, value = authorization.partition(" ")
        if scheme.casefold() != _SCHEME or not value:
            return False
        try:
            candidate = value.strip().encode("ascii")
        except UnicodeEncodeError:
            return False
        return hmac.compare_digest(candidate, self._token)
