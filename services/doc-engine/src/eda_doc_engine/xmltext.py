"""XML yazım yardımcıları (084 §8.5: kullanıcı metni her zaman kaçışlanır veya CDATA bölünür)."""

from decimal import Decimal


def esc(text: str) -> str:
    """Öğe metni ve öznitelik değeri kaçışı (`&`, `<`, `>`, `"`)."""
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )


def attrs(pairs: list[tuple[str, str]]) -> str:
    return "".join(f' {name}="{esc(value)}"' for name, value in pairs)


def cdata(text: str) -> str:
    """CDATA bölümü; `]]>` geçerse bölünür: `]]]]><![CDATA[>` (084 §2.4)."""
    return "<![CDATA[" + text.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def num(value: Decimal | float | int) -> str:
    """Ondalık nokta, en çok 3 hane, bilimsel gösterim yok, en az bir ondalık (084 §2.5)."""
    d = value if isinstance(value, Decimal) else Decimal(repr(float(value)))
    text = format(d.quantize(Decimal("0.001")), "f").rstrip("0")
    if text.endswith("."):
        text += "0"
    return "0.0" if text in ("-0.0", "0.0") else text


def utf16_len(text: str) -> int:
    """UTF-16 kod birimi sayısı (Java `String.length()`; 084 §2.4, H-9)."""
    return len(text.encode("utf-16-le", "surrogatepass")) // 2
