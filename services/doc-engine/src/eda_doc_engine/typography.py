"""Belge tipografisi ölçü sabitleri (084 §2.5 ölçü tablosu, §5.1).

Ekran, DOCX, UDF ve PDF aynı ölçü kaynağından türer. Birimler: mm, pt (1/72 inç), twip (1/20 pt),
EMU (1/914400 inç). Dönüşüm işlevleri tek yerdedir; yazıcılar sayı gömmez.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Final

MM_PER_INCH: Final = 25.4
PT_PER_INCH: Final = 72
TWIP_PER_INCH: Final = 1440
EMU_PER_INCH: Final = 914400

# Sayfa (A4 dikey) ve kenar boşlukları (DocAST `page.marginsMm` sabitleriyle aynı).
PAGE_WIDTH_MM: Final = 210.0
PAGE_HEIGHT_MM: Final = 297.0
MARGIN_TOP_MM: Final = 20.0
MARGIN_BOTTOM_MM: Final = 20.0
MARGIN_LEFT_MM: Final = 25.0
MARGIN_RIGHT_MM: Final = 20.0
TEXT_WIDTH_MM: Final = PAGE_WIDTH_MM - MARGIN_LEFT_MM - MARGIN_RIGHT_MM  # 165

# 084 §2.5 tablosu (DOCX twip). A4 twip değerleri tablodaki yuvarlanmış değerlerdir.
PAGE_WIDTH_TWIP: Final = 11906
PAGE_HEIGHT_TWIP: Final = 16838
HEADER_FOOTER_DISTANCE_TWIP: Final = 567  # 10 mm (084 §4.1 `w:header`/`w:footer`)
PAGE_WIDTH_PT: Final = 595.28
PAGE_HEIGHT_PT: Final = 841.89

FIRST_LINE_INDENT_MM: Final = 12.5  # 1,25 cm
SIGNATURE_BOX_WIDTH_MM: Final = 70.0

# Yazı boyutları (pt) ve satır aralığı.
BODY_SIZE_PT: Final = 12
NOTE_SIZE_PT: Final = 10  # antet, alt bilgi
LINE_HEIGHT: Final = 1.5
SINGLE_LINE_TWIP: Final = 240  # `w:line` tek aralık (auto)

# Paragraf aralıkları (084 §5.1, §5.2).
SECTION_SPACE_BEFORE_PT: Final = 12.0
COURT_HEADER_SPACE_AFTER_PT: Final = 18.0

# Tablo (084 §4.1).
TABLE_CELL_MARGIN_TWIP: Final = 108
TABLE_BORDER_EIGHTHS_PT: Final = 4  # 0,5 pt

# Yazı tipi adları (084 §2.6, §4.1, E-1).
DOCX_FONT: Final = "Liberation Serif"
DOCX_FONT_ALT: Final = "Times New Roman"
UDF_FONT: Final = "Times New Roman"
PDF_FONT_POSTSCRIPT: Final = "LiberationSerif"


def mm_to_twip(mm: float) -> int:
    """mm -> twip (`mm / 25.4 x 1440`, en yakına yuvarlanır; 084 §4.1)."""
    return int(Decimal(repr(mm * TWIP_PER_INCH / MM_PER_INCH)).quantize(Decimal(1), ROUND_HALF_UP))


def mm_to_pt(mm: float) -> Decimal:
    """mm -> pt, en çok 3 ondalık (084 §2.5: `pt = mm x 72 / 25.4`)."""
    return pt_round(Decimal(repr(mm)) * PT_PER_INCH / Decimal(repr(MM_PER_INCH)))


def pt_round(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.001"), ROUND_HALF_UP)


def pt_to_twip(pt: float) -> int:
    return int(Decimal(repr(pt * 20)).quantize(Decimal(1), ROUND_HALF_UP))


def emu_to_pt(emu: int) -> Decimal:
    """EMU -> pt (`EMU x 72 / 914400`; görsel boyutu, V1.1 kancası; KK-084-7)."""
    return pt_round(Decimal(emu) * PT_PER_INCH / EMU_PER_INCH)


def mm_to_emu(mm: float) -> int:
    return int(Decimal(repr(mm)) * EMU_PER_INCH / Decimal(repr(MM_PER_INCH)))


TEXT_WIDTH_TWIP: Final = mm_to_twip(TEXT_WIDTH_MM)  # 9354
TEXT_WIDTH_PT: Final = mm_to_pt(TEXT_WIDTH_MM)  # 467.717
FIRST_LINE_INDENT_TWIP: Final = mm_to_twip(FIRST_LINE_INDENT_MM)  # 709
FIRST_LINE_INDENT_PT: Final = mm_to_pt(FIRST_LINE_INDENT_MM)  # 35.433
MARGIN_TOP_TWIP: Final = mm_to_twip(MARGIN_TOP_MM)  # 1134
MARGIN_BOTTOM_TWIP: Final = mm_to_twip(MARGIN_BOTTOM_MM)  # 1134
MARGIN_LEFT_TWIP: Final = mm_to_twip(MARGIN_LEFT_MM)  # 1417
MARGIN_RIGHT_TWIP: Final = mm_to_twip(MARGIN_RIGHT_MM)  # 1134
MARGIN_TOP_PT: Final = mm_to_pt(MARGIN_TOP_MM)  # 56.693
MARGIN_BOTTOM_PT: Final = mm_to_pt(MARGIN_BOTTOM_MM)
MARGIN_LEFT_PT: Final = mm_to_pt(MARGIN_LEFT_MM)  # 70.866
MARGIN_RIGHT_PT: Final = mm_to_pt(MARGIN_RIGHT_MM)
BODY_LINE_TWIP: Final = round(SINGLE_LINE_TWIP * LINE_HEIGHT)  # 360
