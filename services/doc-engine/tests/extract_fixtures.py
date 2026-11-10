"""Metin katmanlı sentetik PDF ve DOCX üreticileri (mevcut bağımlılıklar: pypdf, python-docx).

PDF: standart Helvetica yazı tipi, WinAnsi + `/Differences` ile Türkçe glifler (ğ Ğ ş Ş ı İ); pypdf
glif adlarından Unicode'a çevirir. İçerik sentetiktir.
"""

import io

from pypdf import PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
)

_TURKISH = {
    "ğ": (0x80, "/gbreve"),
    "Ğ": (0x81, "/Gbreve"),
    "ş": (0x82, "/scedilla"),
    "Ş": (0x83, "/Scedilla"),
    "ı": (0x84, "/dotlessi"),
    "İ": (0x85, "/Idotaccent"),
}


def _encode(line: str) -> bytes:
    out = bytearray()
    for ch in line:
        if ch in _TURKISH:
            out.append(_TURKISH[ch][0])
            continue
        b = ch.encode("cp1252")
        if b in (b"(", b")", b"\\"):
            out += b"\\"
        out += b
    return bytes(out)


def make_text_pdf(pages: list[list[str]]) -> bytes:
    """Her sayfa satır listesidir; satırlar yukarıdan aşağı yazılır."""
    writer = PdfWriter()
    diffs = ArrayObject([NumberObject(0x80)])
    for _ch, (_code, glyph) in sorted(_TURKISH.items(), key=lambda kv: kv[1][0]):
        diffs.append(NameObject(glyph))
    font = writer._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
                NameObject("/Encoding"): DictionaryObject(
                    {
                        NameObject("/Type"): NameObject("/Encoding"),
                        NameObject("/BaseEncoding"): NameObject("/WinAnsiEncoding"),
                        NameObject("/Differences"): diffs,
                    }
                ),
            }
        )
    )
    for lines in pages:
        page = writer.add_blank_page(595.3, 841.9)
        ops = [b"BT", b"/F1 11 Tf", b"14 TL", b"56 790 Td"]
        for line in lines:
            ops.append(b"(" + _encode(line) + b") Tj T*")
        ops.append(b"ET")
        stream = DecodedStreamObject()
        stream.set_data(b"\n".join(ops))
        page[NameObject("/Contents")] = writer._add_object(stream)
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def encrypt_pdf(data: bytes, password: str) -> bytes:
    from pypdf import PdfReader

    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(data)))
    writer.encrypt(user_password=password, owner_password=password, algorithm="RC4-40")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def make_docx(
    paragraphs: list[str], hidden: str | None = None, table: list[list[str]] | None = None
) -> bytes:
    from docx import Document

    doc = Document()
    for text in paragraphs:
        doc.add_paragraph(text)
    if hidden is not None:
        p = doc.add_paragraph("Görünür kısım. ")
        run = p.add_run(hidden)
        run.font.hidden = True
    if table is not None:
        t = doc.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, cell in enumerate(row):
                t.cell(r, c).text = cell
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()
