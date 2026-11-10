"""DocAST -> DOCX yazıcı (084 §4.1, §5).

Paket ham OOXML olarak yazılır: python-docx varsayılan şablonunun kenar boşluğu, stil ve tema mirası
DocAST'ı ezmesin diye `styles.xml`, `settings.xml`, `fontTable.xml`, `numbering.xml` ve üst/alt
bilgi parçaları bu modülde açıkça üretilir (084 Kodlama Notları 10; AS-0294). Öğe sıraları ECMA-376
şema dizilerine uyar. Paket `normalize_zip()` ile sıralı ve sabit zaman damgalıdır (084 İ3).
"""

from dataclasses import dataclass
from datetime import UTC, datetime

from eda_doc_engine import report as rp
from eda_doc_engine.layout import DocLayout, LineBreak, Para, Table, TextRun
from eda_doc_engine.typography import (
    BODY_LINE_TWIP,
    BODY_SIZE_PT,
    DOCX_FONT,
    DOCX_FONT_ALT,
    FIRST_LINE_INDENT_TWIP,
    HEADER_FOOTER_DISTANCE_TWIP,
    MARGIN_BOTTOM_TWIP,
    MARGIN_LEFT_TWIP,
    MARGIN_RIGHT_TWIP,
    MARGIN_TOP_TWIP,
    NOTE_SIZE_PT,
    PAGE_HEIGHT_TWIP,
    PAGE_WIDTH_TWIP,
    SINGLE_LINE_TWIP,
    TABLE_BORDER_EIGHTHS_PT,
    TABLE_CELL_MARGIN_TWIP,
    TEXT_WIDTH_TWIP,
    mm_to_twip,
    pt_to_twip,
)
from eda_doc_engine.xmltext import attrs, esc
from eda_doc_engine.ziputil import normalize_zip, zip_time

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT_BASE = "application/vnd.openxmlformats-officedocument.wordprocessingml"
XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
_JC = {"left": "left", "center": "center", "right": "right", "justify": "both"}
_HEADING_STYLE = {"heading1": "Heading1", "heading2": "Heading2"}
_BULLET = "•"


@dataclass(frozen=True, slots=True)
class DocxOptions:
    page_numbers: bool
    timestamp: datetime
    # Yalnız L6 ölçüm referansı (tek aralıklı sürüm; 084 §9.5 madde 3). API bu alanı açmaz.
    body_line_twip: int = BODY_LINE_TWIP


def _rpr(
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    link: bool = False,
    size_pt: int | None = None,
) -> str:
    parts: list[str] = []
    if link:
        parts.append('<w:rStyle w:val="Hyperlink"/>')
    if bold:
        parts.append("<w:b/><w:bCs/>")
    if italic:
        parts.append("<w:i/><w:iCs/>")
    if strike:
        parts.append("<w:strike/>")
    if size_pt is not None:
        half = str(size_pt * 2)
        parts.append(f'<w:sz w:val="{half}"/><w:szCs w:val="{half}"/>')
    if underline:
        parts.append('<w:u w:val="single"/>')
    return f"<w:rPr>{''.join(parts)}</w:rPr>" if parts else ""


def _text_runs(text: str, rpr: str) -> str:
    """Metni `w:t` / `w:tab` çalıştırmalarına çevirir (sekme yalnız taraf/konu rolünde kalır)."""
    out: list[str] = []
    for i, part in enumerate(text.split("\t")):
        if i > 0:
            out.append(f"<w:r>{rpr}<w:tab/></w:r>")
        if part:
            out.append(f'<w:r>{rpr}<w:t xml:space="preserve">{esc(part)}</w:t></w:r>')
    return "".join(out)


class _Doc:
    def __init__(self, layout: DocLayout, options: DocxOptions) -> None:
        self.layout = layout
        self.options = options
        self.degraded = rp.Degraded()
        self.degraded.add(rp.FORBIDDEN_CHAR, layout.forbidden_chars)
        self.degraded.add(rp.HYPERLINK_PROTOCOL, layout.demoted_links)
        self.links: list[str] = []
        # Sabit ilişki kimlikleri: rId1.. sabit parçalar, sonra bağlantılar (belge sırası).
        self.fixed_rels = ["styles", "settings", "fontTable", "numbering"]
        if layout.header_lines:
            self.fixed_rels.append("header")
        if options.page_numbers:
            self.fixed_rels.append("footer")

    def rel_id(self, name: str) -> str:
        return f"rId{self.fixed_rels.index(name) + 1}"

    def link_id(self, href: str) -> str:
        self.links.append(href)
        return f"rId{len(self.fixed_rels) + len(self.links)}"

    # ---- paragraf ----

    def ppr(self, p: Para) -> str:
        parts: list[str] = []
        if p.kind in _HEADING_STYLE:
            parts.append(f'<w:pStyle w:val="{_HEADING_STYLE[p.kind]}"/>')
        if p.keep_next:
            parts.append("<w:keepNext/>")
        if p.keep_lines:
            parts.append("<w:keepLines/>")
        ref = p.list_ref
        if ref is not None and ref.numbered:
            parts.append(
                f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{ref.index + 1}"/></w:numPr>'
            )
        if p.tab_stops_mm:
            tabs = "".join(f'<w:tab w:val="left" w:pos="{mm_to_twip(t)}"/>' for t in p.tab_stops_mm)
            parts.append(f"<w:tabs>{tabs}</w:tabs>")
        spacing: list[tuple[str, str]] = []
        if p.space_before_pt:
            spacing.append(("w:before", str(pt_to_twip(p.space_before_pt))))
        if p.space_after_pt:
            spacing.append(("w:after", str(pt_to_twip(p.space_after_pt))))
        if p.kind == "cell":
            spacing += [("w:line", str(SINGLE_LINE_TWIP)), ("w:lineRule", "auto")]
        elif self.options.body_line_twip != BODY_LINE_TWIP:
            spacing += [("w:line", str(self.options.body_line_twip)), ("w:lineRule", "auto")]
        if spacing:
            parts.append(f"<w:spacing{attrs(spacing)}/>")
        if p.box_left_mm is not None:
            ind = [("w:left", str(mm_to_twip(p.box_left_mm))), ("w:firstLine", "0")]
        elif p.indent == "hanging" and p.hanging_mm is not None:
            h = str(mm_to_twip(p.hanging_mm))
            ind = [("w:left", h), ("w:hanging", h)]
        elif p.indent == "first_line":
            ind = [("w:left", "0"), ("w:firstLine", str(FIRST_LINE_INDENT_TWIP))]
        else:
            ind = [("w:left", "0"), ("w:firstLine", "0")]
        parts.append(f"<w:ind{attrs(ind)}/>")
        parts.append(f'<w:jc w:val="{_JC[p.align]}"/>')
        return f"<w:pPr>{''.join(parts)}</w:pPr>"

    def runs(self, p: Para) -> str:
        out: list[str] = []
        for run in p.runs:
            if isinstance(run, LineBreak):
                out.append("<w:r><w:br/></w:r>")
                continue
            out.append(self.run(run))
        return "".join(out)

    def run(self, run: TextRun) -> str:
        link = run.href is not None
        rpr = _rpr(run.bold, run.italic, run.underline, run.strike, link=link)
        body = _text_runs(run.text, rpr)
        if run.href is not None:
            return f'<w:hyperlink r:id="{self.link_id(run.href)}">{body}</w:hyperlink>'
        return body

    def para(self, p: Para) -> str:
        return f"<w:p>{self.ppr(p)}{self.runs(p)}</w:p>"

    # ---- tablo ----

    def table(self, t: Table) -> str:
        total = sum(t.widths_mm)
        cols = [round(TEXT_WIDTH_TWIP * w / total) for w in t.widths_mm[:-1]]
        cols.append(TEXT_WIDTH_TWIP - sum(cols))
        if t.borders == "grid":
            edge = f'w:val="single" w:sz="{TABLE_BORDER_EIGHTHS_PT}" w:space="0" w:color="000000"'
        else:
            edge = 'w:val="nil"'
        borders = "".join(
            f"<w:{side} {edge}/>"
            for side in ("top", "left", "bottom", "right", "insideH", "insideV")
        )
        out = [
            "<w:tbl><w:tblPr>",
            f'<w:tblW w:w="{TEXT_WIDTH_TWIP}" w:type="dxa"/>',
            f"<w:tblBorders>{borders}</w:tblBorders>",
            '<w:tblLayout w:type="fixed"/>',
            "<w:tblCellMar>",
            f'<w:left w:w="{TABLE_CELL_MARGIN_TWIP}" w:type="dxa"/>',
            f'<w:right w:w="{TABLE_CELL_MARGIN_TWIP}" w:type="dxa"/>',
            "</w:tblCellMar></w:tblPr><w:tblGrid>",
            "".join(f'<w:gridCol w:w="{c}"/>' for c in cols),
            "</w:tblGrid>",
        ]
        for r, row in enumerate(t.rows):
            header = "<w:tblHeader/>" if r < t.header_rows else ""
            out.append(f"<w:tr><w:trPr><w:cantSplit/>{header}</w:trPr>")
            for c, cell in enumerate(row):
                out.append(f'<w:tc><w:tcPr><w:tcW w:w="{cols[c]}" w:type="dxa"/></w:tcPr>')
                out.extend(self.para(p) for p in cell.paras)
                out.append("</w:tc>")
            out.append("</w:tr>")
        out.append("</w:tbl>")
        return "".join(out)

    # ---- parçalar ----

    def document_xml(self) -> str:
        body: list[str] = []
        for sec in self.layout.sections:
            for blk in sec.blocks:
                body.append(self.para(blk) if isinstance(blk, Para) else self.table(blk))
        refs = ""
        if self.layout.header_lines:
            refs += f'<w:headerReference w:type="default" r:id="{self.rel_id("header")}"/>'
        if self.options.page_numbers:
            refs += f'<w:footerReference w:type="default" r:id="{self.rel_id("footer")}"/>'
        sect = (
            f"<w:sectPr>{refs}"
            f'<w:pgSz w:w="{PAGE_WIDTH_TWIP}" w:h="{PAGE_HEIGHT_TWIP}"/>'
            f'<w:pgMar w:top="{MARGIN_TOP_TWIP}" w:right="{MARGIN_RIGHT_TWIP}" '
            f'w:bottom="{MARGIN_BOTTOM_TWIP}" w:left="{MARGIN_LEFT_TWIP}" '
            f'w:header="{HEADER_FOOTER_DISTANCE_TWIP}" w:footer="{HEADER_FOOTER_DISTANCE_TWIP}" '
            'w:gutter="0"/>'
            "</w:sectPr>"
        )
        return (
            f'{XML_DECL}<w:document xmlns:w="{NS_W}" xmlns:r="{NS_R}"><w:body>'
            + "".join(body)
            + sect
            + "</w:body></w:document>"
        )

    def header_xml(self) -> str:
        paras: list[str] = []
        for i, line in enumerate(self.layout.header_lines):
            rpr = _rpr(i == 0, False, False, False, size_pt=NOTE_SIZE_PT)
            paras.append(
                "<w:p><w:pPr>"
                f'<w:spacing w:line="{SINGLE_LINE_TWIP}" w:lineRule="auto"/>'
                '<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/>'
                f"</w:pPr>{_text_runs(line, rpr)}</w:p>"
            )
        return f'{XML_DECL}<w:hdr xmlns:w="{NS_W}" xmlns:r="{NS_R}">{"".join(paras)}</w:hdr>'

    def footer_xml(self) -> str:
        rpr = _rpr(False, False, False, False, size_pt=NOTE_SIZE_PT)
        return (
            f'{XML_DECL}<w:ftr xmlns:w="{NS_W}" xmlns:r="{NS_R}"><w:p><w:pPr>'
            f'<w:spacing w:line="{SINGLE_LINE_TWIP}" w:lineRule="auto"/>'
            '<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr>'
            f'<w:fldSimple w:instr=" PAGE "><w:r>{rpr}<w:t>1</w:t></w:r></w:fldSimple>'
            "</w:p></w:ftr>"
        )

    def styles_xml(self) -> str:
        size = str(BODY_SIZE_PT * 2)
        fonts = (
            f'<w:rFonts w:ascii="{DOCX_FONT}" w:hAnsi="{DOCX_FONT}" '
            f'w:eastAsia="{DOCX_FONT}" w:cs="{DOCX_FONT}"/>'
        )
        defaults = (
            "<w:docDefaults><w:rPrDefault><w:rPr>"
            f'{fonts}<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
            '<w:lang w:val="tr-TR"/>'
            "</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/>"
            f'<w:spacing w:before="0" w:after="0" w:line="{BODY_LINE_TWIP}" w:lineRule="auto"/>'
            '<w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>'
        )

        def heading(n: int) -> str:
            return (
                f'<w:style w:type="paragraph" w:styleId="Heading{n}">'
                f'<w:name w:val="heading {n}"/><w:basedOn w:val="Normal"/>'
                '<w:next w:val="Normal"/><w:qFormat/>'
                '<w:pPr><w:keepNext/><w:ind w:left="0" w:firstLine="0"/>'
                f'<w:jc w:val="left"/><w:outlineLvl w:val="{n - 1}"/></w:pPr>'
                f'<w:rPr><w:b/><w:bCs/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr>'
                "</w:style>"
            )

        return (
            f'{XML_DECL}<w:styles xmlns:w="{NS_W}">{defaults}'
            '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
            '<w:name w:val="Normal"/><w:qFormat/></w:style>'
            '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">'
            '<w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/>'
            "<w:semiHidden/><w:unhideWhenUsed/></w:style>"
            '<w:style w:type="table" w:default="1" w:styleId="TableNormal">'
            '<w:name w:val="Normal Table"/><w:semiHidden/><w:unhideWhenUsed/>'
            '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar>'
            f'<w:top w:w="0" w:type="dxa"/><w:left w:w="{TABLE_CELL_MARGIN_TWIP}" w:type="dxa"/>'
            f'<w:bottom w:w="0" w:type="dxa"/><w:right w:w="{TABLE_CELL_MARGIN_TWIP}" '
            'w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
            f"{heading(1)}{heading(2)}"
            '<w:style w:type="character" w:styleId="Hyperlink">'
            '<w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/>'
            '<w:rPr><w:u w:val="single"/></w:rPr></w:style>'
            "</w:styles>"
        )

    def settings_xml(self) -> str:
        return (
            f'{XML_DECL}<w:settings xmlns:w="{NS_W}">'
            f'<w:defaultTabStop w:val="{FIRST_LINE_INDENT_TWIP}"/>'
            '<w:autoHyphenation w:val="false"/>'
            '<w:characterSpacingControl w:val="doNotCompress"/>'
            "<w:compat>"
            '<w:compatSetting w:name="compatibilityMode" '
            'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>'
            "</w:compat></w:settings>"
        )

    def font_table_xml(self) -> str:
        return (
            f'{XML_DECL}<w:fonts xmlns:w="{NS_W}">'
            f'<w:font w:name="{DOCX_FONT}"><w:altName w:val="{DOCX_FONT_ALT}"/>'
            '<w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/>'
            "</w:font></w:fonts>"
        )

    def numbering_xml(self) -> str:
        def abstract(abs_id: int, fmt: str, text: str) -> str:
            return (
                f'<w:abstractNum w:abstractNumId="{abs_id}">'
                '<w:multiLevelType w:val="singleLevel"/>'
                f'<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/>'
                f'<w:suff w:val="space"/><w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/>'
                f'<w:pPr><w:ind w:left="0" w:firstLine="{FIRST_LINE_INDENT_TWIP}"/></w:pPr>'
                "</w:lvl></w:abstractNum>"
            )

        nums: list[str] = []
        for i, (ordered, start) in enumerate(
            zip(self.layout.lists_ordered, self.layout.list_starts, strict=True)
        ):
            override = (
                f'<w:lvlOverride w:ilvl="0"><w:startOverride w:val="{start}"/></w:lvlOverride>'
                if ordered
                else ""
            )
            nums.append(
                f'<w:num w:numId="{i + 1}"><w:abstractNumId w:val="{0 if ordered else 1}"/>'
                f"{override}</w:num>"
            )
        return (
            f'{XML_DECL}<w:numbering xmlns:w="{NS_W}">'
            + abstract(0, "decimal", "%1.")
            + abstract(1, "bullet", _BULLET)
            + "".join(nums)
            + "</w:numbering>"
        )

    def core_xml(self) -> str:
        stamp = self.options.timestamp.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        return (
            f"{XML_DECL}<cp:coreProperties "
            'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" '
            'xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f"<dc:title>{esc(self.layout.title)}</dc:title>"
            "<dc:creator></dc:creator><cp:lastModifiedBy></cp:lastModifiedBy>"
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{stamp}</dcterms:created>'
            f'<dcterms:modified xsi:type="dcterms:W3CDTF">{stamp}</dcterms:modified>'
            "</cp:coreProperties>"
        )

    def document_rels(self) -> str:
        targets = {
            "styles": ("styles", "styles.xml"),
            "settings": ("settings", "settings.xml"),
            "fontTable": ("fontTable", "fontTable.xml"),
            "numbering": ("numbering", "numbering.xml"),
            "header": ("header", "header1.xml"),
            "footer": ("footer", "footer1.xml"),
        }
        rels = [
            f'<Relationship Id="{self.rel_id(name)}" Type="{REL}/{targets[name][0]}" '
            f'Target="{targets[name][1]}"/>'
            for name in self.fixed_rels
        ]
        base = len(self.fixed_rels)
        rels += [
            f'<Relationship Id="rId{base + i + 1}" Type="{REL}/hyperlink" '
            f'Target="{esc(href)}" TargetMode="External"/>'
            for i, href in enumerate(self.links)
        ]
        return f'{XML_DECL}<Relationships xmlns="{NS_PKG_REL}">{"".join(rels)}</Relationships>'

    def content_types(self) -> str:
        overrides = [
            ("/word/document.xml", f"{CT_BASE}.document.main+xml"),
            ("/word/styles.xml", f"{CT_BASE}.styles+xml"),
            ("/word/settings.xml", f"{CT_BASE}.settings+xml"),
            ("/word/fontTable.xml", f"{CT_BASE}.fontTable+xml"),
            ("/word/numbering.xml", f"{CT_BASE}.numbering+xml"),
            ("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"),
        ]
        if self.layout.header_lines:
            overrides.append(("/word/header1.xml", f"{CT_BASE}.header+xml"))
        if self.options.page_numbers:
            overrides.append(("/word/footer1.xml", f"{CT_BASE}.footer+xml"))
        body = "".join(
            f'<Override PartName="{part}" ContentType="{ct}"/>' for part, ct in overrides
        )
        return (
            f"{XML_DECL}<Types "
            'xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" '
            'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            f"{body}</Types>"
        )

    def root_rels(self) -> str:
        return (
            f'{XML_DECL}<Relationships xmlns="{NS_PKG_REL}">'
            f'<Relationship Id="rId1" Type="{REL}/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" '
            'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/'
            'core-properties" Target="docProps/core.xml"/>'
            "</Relationships>"
        )

    def parts(self) -> dict[str, bytes]:
        document = self.document_xml()  # bağlantı ilişkileri burada toplanır
        parts = {
            "[Content_Types].xml": self.content_types(),
            "_rels/.rels": self.root_rels(),
            "docProps/core.xml": self.core_xml(),
            "word/document.xml": document,
            "word/_rels/document.xml.rels": self.document_rels(),
            "word/styles.xml": self.styles_xml(),
            "word/settings.xml": self.settings_xml(),
            "word/fontTable.xml": self.font_table_xml(),
            "word/numbering.xml": self.numbering_xml(),
        }
        if self.layout.header_lines:
            parts["word/header1.xml"] = self.header_xml()
        if self.options.page_numbers:
            parts["word/footer1.xml"] = self.footer_xml()
        return {name: xml.encode("utf-8") for name, xml in parts.items()}


def write_docx(layout: DocLayout, options: DocxOptions) -> tuple[bytes, rp.Degraded]:
    doc = _Doc(layout, options)
    data = normalize_zip(doc.parts(), zip_time(options.timestamp.astimezone(UTC)))
    return data, doc.degraded


def now_utc() -> datetime:
    return datetime.now(UTC)
