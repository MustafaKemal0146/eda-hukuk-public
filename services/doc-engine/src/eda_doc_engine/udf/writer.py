"""DocAST -> UDF yazıcı (084 §2, §4.2). TEMİZ ODA (Y-111).

Yalnız 084 §2 biçim olgularından ve `profile.py` hipotez varsayılanlarından yazılmıştır; başka bir
dönüştürücünün kodu veya yapısı kullanılmamıştır. Çıktının UYAP Doküman Editörü'nde açıldığı
gerçek fixture'larla doğrulanmamıştır (084 §2.1, KK-084-20): çıktı "doğrulanmadı" sayılır.

Kurallar: tek metin havuzu (üst bilgi -> gövde), ofset/uzunluk UTF-16 kod birimi, her paragraf ve
çalıştırma tüm biçim özniteliklerini açıkça taşır (084 İ4), ZIP'te yalnız `content.xml`.
"""

from dataclasses import dataclass, field
from decimal import Decimal

from eda_doc_engine import report as rp
from eda_doc_engine.layout import DocLayout, LineBreak, Para, Table, TextRun
from eda_doc_engine.typography import (
    BODY_SIZE_PT,
    FIRST_LINE_INDENT_PT,
    LINE_HEIGHT,
    MARGIN_BOTTOM_PT,
    MARGIN_LEFT_PT,
    MARGIN_RIGHT_PT,
    MARGIN_TOP_PT,
    NOTE_SIZE_PT,
    TEXT_WIDTH_PT,
    UDF_FONT,
    mm_to_pt,
    pt_round,
)
from eda_doc_engine.udf import profile
from eda_doc_engine.xmltext import attrs, cdata, num, utf16_len
from eda_doc_engine.ziputil import ZIP_EPOCH, normalize_zip

CONTENT_XML = "content.xml"
_TAB = "\t"
_TAB_ROLES = frozenset({"partiesGrid", "subjectLine"})
_ZERO = Decimal(0)


def argb(rgb: int, alpha: int = 0xFF) -> int:
    """İşaretli 32 bit ARGB (Java `Color.getRGB()`; 084 §2.11)."""
    value = (alpha << 24) | (rgb & 0xFFFFFF)
    return value - (1 << 32) if value >= 1 << 31 else value


_FOREGROUND = str(argb(profile.FOREGROUND_RGB))


@dataclass(slots=True)
class _Piece:
    """Paragraf içi parça: metin çalıştırması veya `<tab/>` öğesi."""

    text: str
    bold: bool = False
    italic: bool = False
    underline: bool = False
    is_tab: bool = False
    start: int = 0
    length: int = 0


@dataclass(slots=True)
class _UdfPara:
    attrs: list[tuple[str, str]]
    size: int
    pieces: list[_Piece] = field(default_factory=list)


def _line_spacing(single: bool) -> str:
    # H-11: `LineSpacing` = satır yüksekliği fazlalığı (LINE_SPACING_MODEL = "excess").
    return num(Decimal(0) if single else Decimal(repr(LINE_HEIGHT)) - 1)


class _Writer:
    def __init__(self, layout: DocLayout, page_numbers: bool) -> None:
        self.layout = layout
        self.degraded = rp.Degraded()
        self.degraded.add(rp.FORBIDDEN_CHAR, layout.forbidden_chars)
        self.degraded.add(rp.HYPERLINK_PROTOCOL, layout.demoted_links)
        if page_numbers:
            self.degraded.add(rp.PAGE_NUMBER)  # H-14: UDF'de sayfa numarası yazılmaz
        for ordered, start in zip(layout.lists_ordered, layout.list_starts, strict=True):
            if ordered and start != 1:
                self.degraded.add(rp.LIST_START)  # H-5: başlangıç numarası taşınamaz
        for sec in layout.sections:
            if sec.keep_together:
                self.degraded.add(rp.KEEP_TOGETHER)  # H-17
        self.order: list[_UdfPara] = []

    # ---- paragraf planı ----

    def _para_attrs(self, p: Para, segment: int, segments: int) -> list[tuple[str, str]]:
        left = _ZERO
        first = _ZERO
        if p.box_left_mm is not None:
            left = mm_to_pt(p.box_left_mm)
        elif p.indent == "hanging" and p.hanging_mm is not None:
            left = mm_to_pt(p.hanging_mm)
            first = -left
        elif p.indent == "first_line":
            first = FIRST_LINE_INDENT_PT
        if segment > 0:
            first = _ZERO  # 084 §4.2: break sonrası parça girintisiz
        heading = p.kind in ("heading1", "heading2")
        out = [
            ("Alignment", profile.ALIGNMENT_MAP["left" if heading else p.align]),
            ("LeftIndent", num(left)),
            ("RightIndent", num(_ZERO)),
            ("FirstLineIndent", num(first)),
            ("LineSpacing", _line_spacing(p.kind == "cell")),
            ("SpaceAbove", num(p.space_before_pt if segment == 0 else 0)),
            ("SpaceBelow", num(p.space_after_pt if segment == segments - 1 else 0)),
        ]
        if p.tab_stops_mm:
            stops = ",".join(
                f"{num(mm_to_pt(t))}:{profile.TAB_ALIGN_LEFT}:{profile.TAB_LEADER_NONE}"
                for t in p.tab_stops_mm
            )
            out.append(("TabSet", stops))
        ref = p.list_ref
        if ref is not None and ref.numbered and segment == 0 and profile.UDF_LIST_MODE == "native":
            list_id = str(ref.index + profile.LIST_ID_BASE)
            if ref.ordered:
                out += [
                    ("Numbered", "true"),
                    ("NumberType", profile.LIST_NUMBER_TYPE),
                    ("ListId", list_id),
                    ("ListLevel", profile.LIST_LEVEL),
                ]
            else:
                out += [
                    ("Bulleted", "true"),
                    ("BulletType", profile.LIST_BULLET_TYPE),
                    ("ListId", list_id),
                    ("ListLevel", profile.LIST_LEVEL),
                ]
        return out

    def _pieces(self, runs: list[TextRun], role: str, force_bold: bool) -> list[_Piece]:
        pieces: list[_Piece] = []
        split_tabs = role in _TAB_ROLES and profile.UDF_TAB_MODE == "element"
        for run in runs:
            if run.strike:
                self.degraded.add(rp.STRIKE)  # H-10
            if run.href is not None:
                self.degraded.add(rp.HYPERLINK)  # H-10: düz metin
            parts = run.text.split(_TAB) if split_tabs else [run.text]
            for i, part in enumerate(parts):
                if i > 0:
                    pieces.append(_Piece(_TAB, is_tab=True))
                if part:
                    pieces.append(_Piece(part, run.bold or force_bold, run.italic, run.underline))
        return pieces

    def add_para(self, p: Para) -> list[_UdfPara]:
        segments: list[list[TextRun]] = [[]]
        for run in p.runs:
            if isinstance(run, LineBreak):
                self.degraded.add(rp.HARD_BREAK_AS_PARAGRAPH)
                segments.append([])
            else:
                segments[-1].append(run)
        heading = p.kind in ("heading1", "heading2")
        made: list[_UdfPara] = []
        for i, seg in enumerate(segments):
            udf = _UdfPara(self._para_attrs(p, i, len(segments)), BODY_SIZE_PT)
            udf.pieces = self._pieces(seg, p.role, heading)
            ref = p.list_ref
            if ref is not None and ref.numbered and i == 0 and profile.UDF_LIST_MODE == "literal":
                label = f"{ref.start + ref.item}. " if ref.ordered else profile.LITERAL_BULLET
                udf.pieces.insert(0, _Piece(label))
            made.append(udf)
        self.order.extend(made)
        return made

    def add_header(self, line: str, first: bool) -> _UdfPara:
        udf = _UdfPara(
            [
                ("Alignment", profile.ALIGNMENT_MAP["center"]),
                ("LeftIndent", num(_ZERO)),
                ("RightIndent", num(_ZERO)),
                ("FirstLineIndent", num(_ZERO)),
                ("LineSpacing", _line_spacing(True)),
                ("SpaceAbove", num(_ZERO)),
                ("SpaceBelow", num(_ZERO)),
            ],
            NOTE_SIZE_PT,
            [_Piece(line, bold=first)],
        )
        self.order.append(udf)
        return udf

    # ---- havuz ----

    def assign_offsets(self) -> str:
        pool: list[str] = []
        units = 0
        last = len(self.order) - 1
        for k, para in enumerate(self.order):
            if not para.pieces:
                para.pieces = [_Piece(profile.EMPTY_PARAGRAPH_MARK)]  # H-8
            for piece in para.pieces:
                piece.start = units
                piece.length = utf16_len(piece.text)
                pool.append(piece.text)
                units += piece.length
            if k < last or profile.PARAGRAPH_TERMINATOR:
                sep = profile.PARAGRAPH_SEPARATOR
                if profile.RUN_INCLUDES_NEWLINE:
                    para.pieces[-1].length += utf16_len(sep)
                pool.append(sep)
                units += utf16_len(sep)
        return "".join(pool)


def _render_para(p: _UdfPara) -> str:
    inner: list[str] = []
    for piece in p.pieces:
        if piece.is_tab:
            inner.append(f'<tab startOffset="{piece.start}" length="{piece.length}"/>')
            continue
        inner.append(
            "<content"
            + attrs(
                [
                    ("startOffset", str(piece.start)),
                    ("length", str(piece.length)),
                    ("family", UDF_FONT),
                    ("size", str(p.size)),
                    ("bold", _bool(piece.bold)),
                    ("italic", _bool(piece.italic)),
                    ("underline", _bool(piece.underline)),
                    ("foreground", _FOREGROUND),
                ]
            )
            + "/>"
        )
    return "<paragraph" + attrs(p.attrs) + ">" + "".join(inner) + "</paragraph>"


def _bool(value: bool) -> str:
    return "true" if value else "false"


def _column_spans(widths_mm: tuple[float, ...]) -> list[Decimal]:
    """`columnSpans` pt; toplam tam olarak metin sütunu (467.717) olur (084 §2.9, KK-084-7)."""
    total = sum(widths_mm)
    spans = [pt_round(TEXT_WIDTH_PT * Decimal(repr(w / total))) for w in widths_mm[:-1]]
    spans.append(TEXT_WIDTH_PT - sum(spans, _ZERO))
    return spans


def _render_table(t: Table, rows: list[list[list[_UdfPara]]]) -> str:
    spans = _column_spans(t.widths_mm)
    grid = t.borders == "grid"
    table_attrs = [
        ("tableName", profile.TABLE_NAME),
        ("columnCount", str(len(spans))),
        ("columnSpans", ",".join(num(s) for s in spans)),
    ]
    if grid:
        table_attrs.append(("border", "borderCell"))
    out = ["<table" + attrs(table_attrs) + ">"]
    for r, row in enumerate(rows):
        row_type = "headerRow" if r < t.header_rows else "dataRow"
        out.append("<row" + attrs([("rowName", f"row{r + 1}"), ("rowType", row_type)]) + ">")
        for cell in row:
            cell_attrs = [("colspan", "1"), ("align", profile.TABLE_CELL_VALIGN)]
            if grid:
                cell_attrs += [
                    ("border", "borderCell"),
                    ("borderSpec", profile.TABLE_CELL_BORDER_SPEC),
                    ("borderStyle", "solid"),
                ]
            else:
                cell_attrs.append(("border", "borderNone"))
            out.append("<cell" + attrs(cell_attrs) + ">")
            out.extend(_render_para(p) for p in cell)
            out.append("</cell>")
        out.append("</row>")
    out.append("</table>")
    return "".join(out)


def build_content_xml(layout: DocLayout, page_numbers: bool) -> tuple[str, rp.Degraded]:
    w = _Writer(layout, page_numbers)
    header = [w.add_header(line, i == 0) for i, line in enumerate(layout.header_lines)]
    body: list[list[_UdfPara] | tuple[Table, list[list[list[_UdfPara]]]]] = []
    for sec in layout.sections:
        for blk in sec.blocks:
            if isinstance(blk, Para):
                body.append(w.add_para(blk))
            else:
                rows = [
                    [[u for p in cell.paras for u in w.add_para(p)] for cell in row]
                    for row in blk.rows
                ]
                body.append((blk, rows))
    pool = w.assign_offsets()

    elements: list[str] = []
    if header:
        elements.append("<header>" + "".join(_render_para(p) for p in header) + "</header>")
    for item in body:
        if isinstance(item, tuple):
            elements.append(_render_table(*item))
        else:
            elements.extend(_render_para(p) for p in item)

    page = attrs(
        [
            ("mediaSizeName", profile.MEDIA_SIZE_A4),
            ("leftMargin", num(MARGIN_LEFT_PT)),
            ("rightMargin", num(MARGIN_RIGHT_PT)),
            ("topMargin", num(MARGIN_TOP_PT)),
            ("bottomMargin", num(MARGIN_BOTTOM_PT)),
            ("paperOrientation", profile.PAPER_ORIENTATION_PORTRAIT),
            ("headerFOffset", profile.HEADER_FOOTER_OFFSET),
            ("footerFOffset", profile.HEADER_FOOTER_OFFSET),
        ]
    )
    styles = (
        "<styles>"
        + "<style"
        + attrs(
            [
                ("name", "default"),
                ("family", UDF_FONT),
                ("size", str(BODY_SIZE_PT)),
                ("bold", "false"),
                ("italic", "false"),
                ("foreground", _FOREGROUND),
            ]
        )
        + "/>"
        + "<style"
        + attrs([("name", profile.RESOLVER), ("family", UDF_FONT), ("size", str(BODY_SIZE_PT))])
        + "/>"
        + "</styles>"
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8" ?>\n'
        f'<template format_id="{profile.FORMAT_ID}">'
        f"<content>{cdata(pool)}</content>"
        f"<properties><pageFormat{page}/></properties>"
        f'<elements resolver="{profile.RESOLVER}">' + "".join(elements) + "</elements>"
        f"{styles}"
        "</template>"
    )
    return xml, w.degraded


def write_udf(layout: DocLayout, page_numbers: bool) -> tuple[bytes, rp.Degraded]:
    """UDF paketi: yalnız `content.xml`, DEFLATE 6, 1980-01-01, `0o600` (084 §2.2)."""
    xml, degraded = build_content_xml(layout, page_numbers)
    data = normalize_zip({CONTENT_XML: xml.encode("utf-8")}, ZIP_EPOCH, compresslevel=6)
    return data, degraded
