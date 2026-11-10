"""Yapı güvenliği, alt süreç ve çıktı sınırları (033 §7.5, 084 §8, §6).

Env DEĞİL, kod sabitidir (084 AS13). "Başlangıç varsayılanı" olanlar P19/P20'de gerçek belgelerle
ölçülür; değişiklik bu dosyada ve 033 §7.5 tablosunda birlikte yapılır.
"""

from typing import Final

MIB: Final = 1024 * 1024
GIB: Final = 1024 * MIB

# ZIP (033 §7.5; içe aktarma P19b).
ZIP_MAX_ENTRIES: Final = 5_000
ZIP_MAX_UNCOMPRESSED_BYTES: Final = 500 * MIB
ZIP_MAX_RATIO: Final = 100

# XML / UDF / DOCX (084 §8.1-§8.2; başlangıç varsayılanları).
UDF_MAX_CONTENT_XML_BYTES: Final = 64 * MIB
DOCX_MAX_PART_BYTES: Final = 64 * MIB
UDF_MAX_XML_DEPTH: Final = 64
UDF_MAX_ELEMENTS: Final = 2_000_000
XML_MAX_ATTRIBUTE_BYTES: Final = 1 * MIB

# Alt süreç (033 §7.5; 061 CTL-FILE-03).
RLIMIT_AS_BYTES: Final = 3 * GIB
RLIMIT_CPU_SEC: Final = 300
RLIMIT_FSIZE_BYTES: Final = 1 * GIB
RLIMIT_NOFILE: Final = 256
RLIMIT_NPROC: Final = 64
RLIMIT_CORE: Final = 0

# Gotenberg ve PDF (084 §6).
GOTENBERG_TIMEOUT_SEC: Final = 120
PDF_MAX_BYTES: Final = 200 * MIB
PDF_PAGE_SIZE_TOLERANCE_PT: Final = 0.5

# İş dizini yaşam süresi (033 §7.4: 10 dk sonra kendiliğinden silinir) ve temizlik aralığı.
JOB_TTL_SEC: Final = 600
JOB_SWEEP_INTERVAL_SEC: Final = 60

# DocAST girdi sınırları (D2-D4): sayısal alanların akla yatkın aralığı (metin sütunu 165 mm).
DOCAST_MAX_INDENT_MM: Final = 165.0

# Metin çıkarma (033 §7.4; P21 ilk dilimi). `ExtractResult.text` tavanı 10 MB; sayfa başına ortalama
# bu sayıdan az görünür karakter çıkan PDF metin katmanı yok sayılır (taranmış belge).
EXTRACT_MAX_TEXT_BYTES: Final = 10 * MIB
EXTRACT_MIN_TEXT_CHARS_PER_PAGE: Final = 16
EXTRACT_MAX_HIDDEN_ITEMS: Final = 50
