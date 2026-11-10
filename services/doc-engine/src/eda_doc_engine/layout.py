"""DocAST doğrulama (084 §3.2 D2-D10) ve yazıcıların ortak yerleşim planı.

DocAST'ın tek kaynağı `@eda/contracts`'tır; burada şema yoktur. Üretilmiş Pydantic modeli (D1)
doğrulandıktan sonra metin temizlenir (D5, D9), bağlantı protokolü süzülür (D7), sayısal
değişmezler denetlenir (D2-D4) ve bölüm kuralları (084 §4.1, §4.2, §5.2) DOCX ile UDF yazıcısının
paylaştığı paragraf/tablo planına çevrilir. Yazıcılar biçime özgü eşlemeyi yapar.
"""

import math
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal

from eda_doc_engine.errors import ForbiddenPhrase, InvalidDocAst
from eda_doc_engine.limits import DOCAST_MAX_INDENT_MM
from eda_doc_engine.models.generated import docast_schema as ast
from eda_doc_engine.typography import (
    COURT_HEADER_SPACE_AFTER_PT,
    SECTION_SPACE_BEFORE_PT,
    TEXT_WIDTH_MM,
)

Align = Literal["left", "center", "right", "justify"]
Indent = Literal["none", "first_line", "hanging"]
ParaKind = Literal["body", "heading1", "heading2", "cell"]

# D5: atılan karakterler. XML 1.0'da yasak denetimler, DEL ve C1, vekil (surrogate) yarımları,
# U+FFFE/U+FFFF, U+FFFC, U+200B, U+2060, U+FEFF, yumuşak kısa çizgi (084 §5.1), bidi denetimleri ve
# etiket karakterleri. `\t` ve `\n` ayrı ele alınır.
_DROP_CHARS = re.compile(
    "[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ud800-\udfff\ufffe\uffff\ufffc"
    "\u00ad\u200b\u2060\ufeff\u202a-\u202e\u2066-\u2069\U000e0000-\U000e007f]"
)
# D6 (084 §3.2, Y-74). Desen Türkçe katlanmış metinde aranır: İ/I/ı -> i, birleşik nokta atılır,
# tire benzerleri '-' olur; böylece büyük harfli yazımlar da yakalanır.
_FORBIDDEN_PHRASE = re.compile(r"e-?imzalidir|elektronik olarak imzalanm")
_FOLD_TABLE = str.maketrans(
    {
        "\u0130": "i",
        "I": "i",
        "\u0131": "i",
        "\u0307": None,
        "\u2010": "-",
        "\u2011": "-",
        "\u2012": "-",
        "\u2013": "-",
    }
)
_TAB_ROLES = frozenset({"partiesGrid", "subjectLine"})
_ALLOWED_LINK_PREFIXES = ("https:", "mailto:")
_WIDTH_EPS = 1e-6


@dataclass(frozen=True, slots=True)
class TextRun:
    text: str
    bold: bool
    italic: bool
    underline: bool
    strike: bool
    href: str | None


@dataclass(frozen=True, slots=True)
class LineBreak:
    pass


Inline = TextRun | LineBreak


@dataclass(frozen=True, slots=True)
class ListRef:
    """Liste üyeliği: `index` belge sırasında 0 tabanlı liste numarası."""

    index: int
    ordered: bool
    start: int
    numbered: bool
    item: int


@dataclass(slots=True)
class Para:
    kind: ParaKind
    role: str
    align: Align
    indent: Indent
    runs: list[Inline]
    hanging_mm: float | None = None
    tab_stops_mm: tuple[float, ...] = ()
    space_before_pt: float = 0.0
    space_after_pt: float = 0.0
    keep_next: bool = False
    keep_lines: bool = False
    box_left_mm: float | None = None
    list_ref: ListRef | None = None


@dataclass(slots=True)
class Cell:
    header: bool
    paras: list[Para]


@dataclass(slots=True)
class Table:
    borders: Literal["none", "grid"]
    widths_mm: tuple[float, ...]
    rows: list[list[Cell]]
    header_rows: int


Block = Para | Table


@dataclass(slots=True)
class SectionLayout:
    role: str
    keep_together: bool
    blocks: list[Block]


@dataclass(slots=True)
class DocLayout:
    title: str
    header_lines: list[str]
    sections: list[SectionLayout]
    list_count: int
    forbidden_chars: int = 0
    demoted_links: int = 0
    lists_ordered: list[bool] = field(default_factory=list)
    list_starts: list[int] = field(default_factory=list)


class _Cleaner:
    def __init__(self) -> None:
        self.removed = 0

    def text(self, raw: str) -> str:
        normalized = raw.replace("\r\n", "\n").replace("\r", "\n")
        cleaned, n = _DROP_CHARS.subn("", normalized)
        self.removed += n
        return unicodedata.normalize("NFC", cleaned)


def _fold(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(_FOLD_TABLE).lower()


def _check_phrase(text: str) -> None:
    if _FORBIDDEN_PHRASE.search(_fold(text)):
        raise ForbiddenPhrase


def _finite(value: float, low: float, high: float) -> float:
    if not math.isfinite(value) or not low < value <= high:
        raise InvalidDocAst
    return value


class _Builder:
    def __init__(self) -> None:
        self.clean = _Cleaner()
        self.demoted_links = 0
        self.list_ordered: list[bool] = []
        self.list_starts: list[int] = []

    def runs(
        self,
        raw: list[ast.Runs | ast.Runs1]
        | list[ast.Runs2 | ast.Runs3]
        | list[ast.Runs4 | ast.Runs5]
        | list[ast.Runs6 | ast.Runs7],
        role: str,
    ) -> list[Inline]:
        out: list[Inline] = []
        for run in raw:
            if isinstance(run, ast.Runs1 | ast.Runs3 | ast.Runs5 | ast.Runs7):
                out.append(LineBreak())
                continue
            text = self.clean.text(run.text)
            if role not in _TAB_ROLES:
                text = text.replace("\t", " ")
            href = run.href
            if href is not None:
                href = self.clean.text(href).strip()
                if not href.lower().startswith(_ALLOWED_LINK_PREFIXES):
                    self.demoted_links += 1
                    href = None
            for i, part in enumerate(text.split("\n")):
                if i > 0:
                    out.append(LineBreak())
                if part:
                    out.append(TextRun(part, run.bold, run.italic, run.underline, run.strike, href))
        joined = "".join(r.text for r in out if isinstance(r, TextRun))
        _check_phrase(joined)
        return out

    def paragraph(self, block: ast.Blocks, role: str) -> Para:
        indent: Indent = block.indent.value
        hanging = block.hangingMm
        stops = tuple(_finite(t, 0.0, DOCAST_MAX_INDENT_MM) for t in block.tabStopsMm)
        if (indent == "hanging") != (hanging is not None):
            raise InvalidDocAst
        if hanging is not None:
            _finite(hanging, 0.0, DOCAST_MAX_INDENT_MM)
            if not any(abs(t - hanging) < _WIDTH_EPS for t in stops):
                raise InvalidDocAst
        return Para(
            kind="body",
            role=role,
            align=block.align.value,
            indent=indent,
            runs=self.runs(block.runs, role),
            hanging_mm=hanging,
            tab_stops_mm=stops,
            keep_lines=role in _TAB_ROLES,
        )

    def heading(self, block: ast.Blocks1, role: str) -> Para:
        kind: ParaKind = "heading1" if block.level.value == 1 else "heading2"
        return Para(
            kind=kind,
            role=role,
            align="left",
            indent="none",
            runs=self.runs(block.runs, role),
            keep_next=True,
        )

    def list_paras(self, block: ast.Blocks2, role: str) -> list[Para]:
        if block.start < 0:
            raise InvalidDocAst
        index = len(self.list_ordered)
        self.list_ordered.append(block.ordered)
        self.list_starts.append(block.start)
        out: list[Para] = []
        for item_no, item in enumerate(block.items):
            paragraphs = item.paragraphs or [ast.Paragraph(align=ast.Align.justify, runs=[])]
            for i, p in enumerate(paragraphs):
                ref = ListRef(index, block.ordered, block.start, numbered=i == 0, item=item_no)
                out.append(
                    Para(
                        kind="body",
                        role=role,
                        align=p.align.value,
                        indent="first_line",
                        runs=self.runs(p.runs, role),
                        list_ref=ref,
                    )
                )
        return out

    def table(self, block: ast.Blocks3, role: str) -> Table:
        widths = [_finite(w, 0.0, math.inf) for w in block.columnWidthsMm]
        if not widths or not block.rows:
            raise InvalidDocAst
        total = sum(widths)
        # D3: toplam genişlik metin sütununa orantılı ölçeklenir (084 §4.1/§4.2: her zaman 165 mm).
        scaled = tuple(w * TEXT_WIDTH_MM / total for w in widths)
        rows: list[list[Cell]] = []
        for row in block.rows:
            if len(row.cells) != len(widths):
                raise InvalidDocAst
            cells: list[Cell] = []
            for cell in row.cells:
                paragraphs = cell.paragraphs or [ast.Paragraph1(align=ast.Align.left, runs=[])]
                paras = [
                    Para(
                        kind="cell",
                        role=role,
                        align="left",
                        indent="none",
                        runs=self.runs(p.runs, role),
                    )
                    for p in paragraphs
                ]
                cells.append(Cell(header=cell.header, paras=paras))
            rows.append(cells)
        header_rows = 0
        for cells in rows:
            if not any(c.header for c in cells):
                break
            header_rows += 1
        return Table(block.borders.value, scaled, rows, header_rows)


def build_layout(doc: ast.DocAst) -> DocLayout:
    """D2-D10 denetimleri ve ortak yerleşim. İhlalde `InvalidDocAst` / `ForbiddenPhrase`."""
    b = _Builder()
    title = b.clean.text(doc.title)
    _check_phrase(title)
    header_lines: list[str] = []
    for line in doc.header.lines if doc.header is not None else []:
        text = b.clean.text(line).replace("\t", " ").replace("\n", " ").strip()
        _check_phrase(text)
        if text:  # D10
            header_lines.append(text)

    sections: list[SectionLayout] = []
    for section in doc.sections:
        role = section.role.value
        box_left: float | None = None
        if section.layout == ast.Layout.right_box:
            width = section.boxWidthMm
            if width is None:
                raise InvalidDocAst
            box_left = TEXT_WIDTH_MM - _finite(width, 0.0, TEXT_WIDTH_MM)
        blocks: list[Block] = []
        for block in section.blocks:
            if isinstance(block, ast.Blocks):
                blocks.append(b.paragraph(block, role))
            elif isinstance(block, ast.Blocks1):
                blocks.append(b.heading(block, role))
            elif isinstance(block, ast.Blocks2):
                blocks.extend(b.list_paras(block, role))
            else:
                blocks.append(b.table(block, role))
        if not blocks:
            continue
        if box_left is not None:
            for blk in blocks:
                if isinstance(blk, Para):
                    blk.box_left_mm = box_left
                    blk.align = "center"
                    blk.indent = "none"
        sections.append(SectionLayout(role, section.keepTogether, blocks))

    _apply_section_rules(sections)
    return DocLayout(
        title=title,
        header_lines=header_lines,
        sections=sections,
        list_count=len(b.list_ordered),
        forbidden_chars=b.clean.removed,
        demoted_links=b.demoted_links,
        lists_ordered=b.list_ordered,
        list_starts=b.list_starts,
    )


def _apply_section_rules(sections: list[SectionLayout]) -> None:
    """084 §4.1/§4.2 bölüm satırları: bölüm boşlukları ve keepTogether zinciri."""
    for i, sec in enumerate(sections):
        first, last = sec.blocks[0], sec.blocks[-1]
        if i > 0 and isinstance(first, Para):
            first.space_before_pt = SECTION_SPACE_BEFORE_PT
        if sec.role == "courtHeader" and isinstance(last, Para):
            last.space_after_pt = COURT_HEADER_SPACE_AFTER_PT
        if sec.keep_together:
            paras = [blk for blk in sec.blocks if isinstance(blk, Para)]
            for p in paras:
                p.keep_lines = True
            for p in paras[:-1]:
                p.keep_next = True
            if i > 0:
                prev_last = sections[i - 1].blocks[-1]
                if isinstance(prev_last, Para):
                    prev_last.keep_next = True


def iter_paras(layout: DocLayout) -> list[Para]:
    """Belge sırasında tüm paragraflar (tablo hücreleri satır-sütun sırasıyla)."""
    out: list[Para] = []
    for sec in layout.sections:
        for blk in sec.blocks:
            if isinstance(blk, Para):
                out.append(blk)
            else:
                for row in blk.rows:
                    for cell in row:
                        out.extend(cell.paras)
    return out
