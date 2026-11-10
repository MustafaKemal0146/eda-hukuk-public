"""Deterministik ZIP yazımı (084 İ3, §2.2; DOCX `normalize_zip`)."""

import io
import zipfile
from datetime import datetime
from typing import Final

ZIP_EPOCH: Final = (1980, 1, 1, 0, 0, 0)
ENTRY_MODE: Final = 0o600
_UNIX: Final = 3


def zip_time(moment: datetime) -> tuple[int, int, int, int, int, int]:
    """ZIP DOS zamanı (2 sn çözünürlük, 1980 öncesi 1980-01-01)."""
    stamp = (moment.year, moment.month, moment.day, moment.hour, moment.minute, moment.second)
    return max(stamp, ZIP_EPOCH)


def normalize_zip(
    entries: dict[str, bytes],
    stamp: tuple[int, int, int, int, int, int] = ZIP_EPOCH,
    compresslevel: int = 6,
) -> bytes:
    """Girdileri ada göre sıralı, sabit zaman damgası ve izinle DEFLATE ZIP'e yazar.

    Girdi adları yazıcıların sabit kümesindendir; kullanıcı verisinden üretilmez (084 §8.5).
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=False) as zf:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = _UNIX
            info.external_attr = ENTRY_MODE << 16
            zf.writestr(info, entries[name], compresslevel=compresslevel)
    return buf.getvalue()
