"""UDF yazıcı hipotez profili (084 §2.13 H-1...H-17).

UDF için kamuya açık şartname yoktur; bu değerler 084 §2 olgularından seçilmiş **doğrulanmamış**
varsayılanlardır. Gerçek fixture'lar (084 §10, IG-10) gelene dek değişmez; doğrulama sonucu yalnız
bu dosyada ve 084 §2.13 tablosunda güncellenir (AS-0300). Yazıcı bu sabitler dışında biçim kararı
gömmez; kodda sihirli `+1` yoktur.
"""

from typing import Final, Literal

# Kök ve stil (T; 084 §2.3, §2.6).
FORMAT_ID: Final = "1.8"
RESOLVER: Final = "hvl-default"

# H-1: paragraf ayırıcı modeli. Paragraflar arası ayırıcı; son paragraftan sonra yazılmaz
# (PARAGRAPH_TERMINATOR = False). Çalıştırma uzunluğu ayırıcıyı içermez.
PARAGRAPH_SEPARATOR: Final = "\n"
PARAGRAPH_TERMINATOR: Final = False
RUN_INCLUDES_NEWLINE: Final = False

# H-2: tablo metni havuzda belge sırasıyla; yapılar karakter tüketmez; `tableName`.
TABLE_NAME: Final = "Sabit"
TABLE_CELL_BORDER_SPEC: Final = "15"  # 1 üst + 2 sağ + 4 alt + 8 sol
TABLE_CELL_VALIGN: Final = "top"

# H-3: `Alignment` kodları (Java StyleConstants varsayımı).
ALIGNMENT_MAP: Final[dict[str, str]] = {"left": "0", "center": "1", "right": "2", "justify": "3"}

# H-4: sekme gösterimi. 'element': havuzda `\t` + `<tab/>` öğesi;
# 'content': `\t` çalıştırma metninde.
UDF_TAB_MODE: Final[Literal["element", "content"]] = "element"
TAB_ALIGN_LEFT: Final = "0"
TAB_LEADER_NONE: Final = "0"

# H-5: liste. 'native': Numbered/Bulleted öznitelikleri; 'literal': numara metne yazılır.
UDF_LIST_MODE: Final[Literal["native", "literal"]] = "native"
LIST_NUMBER_TYPE: Final = "NUMBER_TYPE_NUMBER_DOT"
LIST_BULLET_TYPE: Final = "BULLET_TYPE_ELLIPSE"
LIST_LEVEL: Final = "0"  # 0 tabanlı (T)
LIST_ID_BASE: Final = 1  # her DocAST listesi ayrı ListId; 1 tabanlı belge sırası
LITERAL_BULLET: Final = "• "

# H-6: boşluklar `content` metnindedir; `<space/>` yazılmaz.
WRITE_SPACE_ELEMENT: Final = False

# H-8: boş paragraf işareti.
EMPTY_PARAGRAPH_MARK: Final = "\u200b"

# H-11: satır aralığı modeli: `LineSpacing` = satır yüksekliği - 1 (1,5x -> 0.5; tek aralık 0.0).
LINE_SPACING_MODEL: Final[Literal["excess"]] = "excess"

# H-12: sayfa yönü (1 dikey).
PAPER_ORIENTATION_PORTRAIT: Final = "1"
MEDIA_SIZE_A4: Final = "1"
HEADER_FOOTER_OFFSET: Final = "20.0"

# H-14: alt bilgi sayfa numarası belirteci bilinmiyor; yazılmaz (bozulma `page_number`).
UDF_PAGE_NUMBER_SPEC: Final[str | None] = None

# H-17: başlıkla-tut / bölünmez karşılığı bilinmiyor (bozulma `keep_together`).
UDF_KEEP_TOGETHER_ATTR: Final[str | None] = None

# 2.11: renk (siyah, alfa 0xFF).
FOREGROUND_RGB: Final = 0x000000
