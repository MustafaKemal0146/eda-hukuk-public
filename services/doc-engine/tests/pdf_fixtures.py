"""Sentetik PDF'ler (Gotenberg sahte taşıyıcısı ve ardıl denetim testleri için)."""

import io

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, TextStringObject


def make_pdf(
    width: float = 595.30,
    height: float = 841.89,
    font: str = "BAAAAA+LiberationSerif",
    embedded: bool = True,
    pages: int = 2,
    title: str | None = None,
    author: str | None = None,
) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        page = writer.add_blank_page(width, height)
        desc = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/FontDescriptor"),
                NameObject("/FontName"): NameObject("/" + font),
            }
        )
        if embedded:
            stream = DecodedStreamObject()
            stream.set_data(b"\x00\x01\x00\x00")
            desc[NameObject("/FontFile2")] = writer._add_object(stream)
        font_dict = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/TrueType"),
                NameObject("/BaseFont"): NameObject("/" + font),
                NameObject("/FontDescriptor"): writer._add_object(desc),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {
                NameObject("/Font"): DictionaryObject(
                    {NameObject("/F1"): writer._add_object(font_dict)}
                )
            }
        )
    info = DictionaryObject()
    if title is not None:
        info[NameObject("/Title")] = TextStringObject(title)
    if author is not None:
        info[NameObject("/Author")] = TextStringObject(author)
    writer.metadata = info
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
