"""doc-engine hata sınıfları. Kodlar `DocEngineError.code` kümesidir (AS-0292).

Mesajlar Türkçedir ve belge içeriği, yol, sır veya iç ayrıntı taşımaz.
"""

from typing import ClassVar


class DocEngineFailure(Exception):
    """HTTP yanıtına eşlenen hata (kod + durum)."""

    code: ClassVar[str] = "export_failed"
    status: ClassVar[int] = 500
    message: ClassVar[str] = "Belge üretilemedi. İşi yeniden deneyin."


class InvalidDocAst(DocEngineFailure):
    """D1-D4 ihlali (084 §3.2)."""

    code = "invalid_docast"
    status = 422
    message = "Belge yapısı geçersiz. Belgeyi editörde düzeltip yeniden dışa aktarın."


class ForbiddenPhrase(DocEngineFailure):
    """D6: e-imza ibaresi (Y-74)."""

    code = "forbidden_phrase"
    status = 422
    message = "Belgede e-imza ibaresi var. İbareyi kaldırıp yeniden dışa aktarın."


class ExportFailed(DocEngineFailure):
    """Üretim/ardıl denetim hatası (`EXPORT_FAILED` sınıfı)."""


class ExportTimeout(DocEngineFailure):
    code = "timeout"
    status = 504
    message = "Belge üretimi zaman aşımına uğradı. İşi yeniden deneyin."


class Unauthorized(DocEngineFailure):
    code = "unauthorized"
    status = 401
    message = "Kimlik doğrulaması gerekli."


class NotFound(DocEngineFailure):
    code = "not_found"
    status = 404
    message = "İş veya türev bulunamadı. Dışa aktarımı yeniden başlatın."


class PayloadTooLarge(DocEngineFailure):
    code = "payload_too_large"
    status = 413
    message = "İstek gövdesi sınırı aştı. Belgeyi küçültüp yeniden deneyin."


class ExtractFailed(DocEngineFailure):
    """Metin çıkarma alt süreci beklenmedik biçimde bitti (P21; AS-0412)."""

    code = "extract_failed"
    status = 500
    message = "Metin çıkarılamadı. İşi yeniden deneyin."


class InvalidExtractRequest(DocEngineFailure):
    """Çıkarma başlıkları eksik veya geçersiz (033 §7.4)."""

    code = "extract_failed"
    status = 422
    message = "Çıkarma isteği geçersiz. İş kimliği, tür ve sayfa sınırı başlıklarını gönderin."
