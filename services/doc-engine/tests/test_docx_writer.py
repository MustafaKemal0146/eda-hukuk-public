"""L5: DOCX XML iddiaları (084 §4.1, §5; KK-P19a-9, 10, 11). @tk TK-15"""

import io
import zipfile
from xml.etree.ElementTree import Element

import docx
from conftest import W, docx_names, docx_part, render
from samples import brk, doc, heading, para, party, petition, plist, request, run, section, table

R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def build(d: dict[str, object], page_numbers: bool = False) -> tuple[bytes, dict[str, int]]:
    data, degraded, _ = render(request(d, "docx", page_numbers=page_numbers))
    return data, degraded


def body_paras(data: bytes) -> list[Element]:
    body = docx_part(data, "word/document.xml").find(f"{W}body")
    assert body is not None
    return [e for e in body if e.tag == f"{W}p"]


def ppr(p: Element, name: str) -> Element | None:
    return p.find(f"{W}pPr/{W}{name}")


def val(e: Element | None, attr: str = "val") -> str | None:
    return None if e is None else e.get(f"{W}{attr}")


def text(p: Element) -> str:
    return "".join(t.text or "" for t in p.iter(f"{W}t"))


# ---------- KK-P19a-10: belge varsayılanları ----------


def test_kk_p19a_10_doc_defaults_settings_fonts_core() -> None:
    data, _ = build(petition(1))
    styles = docx_part(data, "word/styles.xml")
    rpr = styles.find(f"{W}docDefaults/{W}rPrDefault/{W}rPr")
    assert rpr is not None
    fonts = rpr.find(f"{W}rFonts")
    assert fonts is not None
    assert {fonts.get(f"{W}{k}") for k in ("ascii", "hAnsi", "cs", "eastAsia")} == {
        "Liberation Serif"
    }
    assert val(rpr.find(f"{W}sz")) == "24"
    assert val(rpr.find(f"{W}szCs")) == "24"
    assert val(rpr.find(f"{W}lang")) == "tr-TR"
    pdef = styles.find(f"{W}docDefaults/{W}pPrDefault/{W}pPr")
    assert pdef is not None
    sp = pdef.find(f"{W}spacing")
    assert sp is not None
    assert (val(sp, "before"), val(sp, "after"), val(sp, "line"), val(sp, "lineRule")) == (
        "0",
        "0",
        "360",
        "auto",
    )
    assert val(pdef.find(f"{W}jc")) == "both"
    assert pdef.find(f"{W}widowControl") is not None
    settings = docx_part(data, "word/settings.xml")
    assert val(settings.find(f"{W}autoHyphenation")) == "false"
    compat = settings.find(f"{W}compat/{W}compatSetting")
    assert compat is not None
    assert val(compat, "name") == "compatibilityMode"
    assert val(compat) == "15"
    font = docx_part(data, "word/fontTable.xml").find(f"{W}font")
    assert font is not None
    assert val(font, "name") == "Liberation Serif"
    assert val(font.find(f"{W}altName")) == "Times New Roman"
    core = docx_part(data, "docProps/core.xml")
    dc = "{http://purl.org/dc/elements/1.1/}"
    cp = "{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}"
    assert core.findtext(f"{dc}title") == "Örnek dilekçe"
    assert core.findtext(f"{dc}creator") in ("", None)
    assert core.findtext(f"{cp}lastModifiedBy") in ("", None)
    assert "docProps/app.xml" not in docx_names(data)  # Application yazılmaz


def test_kk_p19a_10_page_size_and_margins() -> None:
    data, _ = build(petition(1), page_numbers=True)
    sect = docx_part(data, "word/document.xml").find(f"{W}body/{W}sectPr")
    assert sect is not None
    sz = sect.find(f"{W}pgSz")
    mar = sect.find(f"{W}pgMar")
    assert (val(sz, "w"), val(sz, "h")) == ("11906", "16838")
    assert {
        k: val(mar, k) for k in ("top", "bottom", "left", "right", "header", "footer", "gutter")
    } == {
        "top": "1134",
        "bottom": "1134",
        "left": "1417",
        "right": "1134",
        "header": "567",
        "footer": "567",
        "gutter": "0",
    }
    assert sect.find(f"{W}headerReference") is not None
    assert sect.find(f"{W}footerReference") is not None


def test_kk_p19a_10_package_opens_with_python_docx() -> None:
    data, _ = build(petition(3), page_numbers=True)
    document = docx.Document(io.BytesIO(data))
    texts = [p.text for p in document.paragraphs]
    assert "ÖRNEK NÖBETÇİ ASLİYE HUKUK MAHKEMESİNE" in texts
    assert document.sections[0].page_width == 11906 * 635  # twip -> EMU
    assert document.core_properties.title == "Örnek dilekçe"
    assert document.core_properties.author == ""


# ---------- KK-P19a-9: 084 §4.1 eşleme satırları ----------


def test_kk_p19a_9_paragraph_alignment_and_indents() -> None:
    d = doc(
        [
            section(
                "generic",
                [
                    para(run("a"), align="left", indent="none"),
                    para(run("b"), align="center", indent="first_line"),
                    para(run("c"), align="right", indent="none"),
                    para(run("d"), align="justify", indent="hanging", hanging=30, tabs=[30]),
                ],
            )
        ]
    )
    data, _ = build(d)
    ps = body_paras(data)
    assert [val(ppr(p, "jc")) for p in ps] == ["left", "center", "right", "both"]
    inds = [ppr(p, "ind") for p in ps]
    assert (val(inds[0], "left"), val(inds[0], "firstLine")) == ("0", "0")
    assert (val(inds[1], "left"), val(inds[1], "firstLine")) == ("0", "709")
    assert (val(inds[3], "left"), val(inds[3], "hanging")) == ("1701", "1701")
    tab = ps[3].find(f"{W}pPr/{W}tabs/{W}tab")
    assert (val(tab), val(tab, "pos")) == ("left", "1701")


def test_kk_p19a_9_run_marks_links_and_breaks() -> None:
    d = doc(
        [
            section(
                "generic",
                [
                    para(
                        run("k", bold=True),
                        run("e", italic=True),
                        run("a", underline=True),
                        run("ç", strike=True),
                        brk(),
                        run("bağ", href="https://example.invalid/a"),
                        run("posta", href="mailto:ornek@example.invalid"),
                        run("kötü", href="javascript:alert(1)"),
                    )
                ],
            )
        ]
    )
    data, degraded = build(d)
    p = body_paras(data)[0]
    runs = p.findall(f"{W}r")
    assert runs[0].find(f"{W}rPr/{W}b") is not None
    assert runs[1].find(f"{W}rPr/{W}i") is not None
    assert val(runs[2].find(f"{W}rPr/{W}u")) == "single"
    assert runs[3].find(f"{W}rPr/{W}strike") is not None
    assert runs[4].find(f"{W}br") is not None
    links = p.findall(f"{W}hyperlink")
    assert len(links) == 2
    rels = docx_part(data, "word/_rels/document.xml.rels")
    pkg = "{http://schemas.openxmlformats.org/package/2006/relationships}"
    by_id = {r.get("Id"): r for r in rels.findall(f"{pkg}Relationship")}
    targets = [by_id[link.get(f"{R}id")] for link in links]
    assert [t.get("Target") for t in targets] == [
        "https://example.invalid/a",
        "mailto:ornek@example.invalid",
    ]
    assert all(t.get("TargetMode") == "External" for t in targets)
    assert "kötü" in text(p)  # D7: düz metne iner
    assert degraded == {"hyperlink_protocol": 1}
    style = docx_part(data, "word/styles.xml")
    link_style = next(s for s in style.findall(f"{W}style") if val(s, "styleId") == "Hyperlink")
    assert val(link_style.find(f"{W}rPr/{W}u")) == "single"
    assert link_style.find(f"{W}rPr/{W}color") is None


def test_kk_p19a_9_headings_styles() -> None:
    data, _ = build(doc([section("generic", [heading("BİR", 1), heading("İKİ", 2)])]))
    ps = body_paras(data)
    assert [val(ppr(p, "pStyle")) for p in ps] == ["Heading1", "Heading2"]
    styles = {val(s, "styleId"): s for s in docx_part(data, "word/styles.xml").findall(f"{W}style")}
    for n in (1, 2):
        s = styles[f"Heading{n}"]
        assert s.find(f"{W}pPr/{W}keepNext") is not None
        assert val(s.find(f"{W}pPr/{W}outlineLvl")) == str(n - 1)
        assert val(s.find(f"{W}pPr/{W}jc")) == "left"
        assert s.find(f"{W}rPr/{W}b") is not None
        assert val(s.find(f"{W}rPr/{W}sz")) == "24"


def test_kk_p19a_9_lists_numbering() -> None:
    lst = {
        "type": "list",
        "ordered": True,
        "start": 4,
        "items": [
            {
                "paragraphs": [
                    {"align": "justify", "runs": [run("ilk")]},
                    {"align": "justify", "runs": [run("devam")]},
                ]
            },
        ],
    }
    data, degraded = build(
        doc([section("generic", [lst, plist(["x"], ordered=False), plist(["y"])])])
    )
    assert degraded == {}  # DOCX başlangıç numarasını taşır
    ps = body_paras(data)
    num_ids = [val(p.find(f"{W}pPr/{W}numPr/{W}numId")) for p in ps]
    assert num_ids == ["1", None, "2", "3"]
    assert (val(ppr(ps[1], "ind"), "left"), val(ppr(ps[1], "ind"), "firstLine")) == ("0", "709")
    numbering = docx_part(data, "word/numbering.xml")
    absn = {val(a, "abstractNumId"): a for a in numbering.findall(f"{W}abstractNum")}
    dec = absn["0"].find(f"{W}lvl")
    assert dec is not None
    assert val(dec.find(f"{W}numFmt")) == "decimal"
    assert val(dec.find(f"{W}lvlText")) == "%1."
    assert val(dec.find(f"{W}suff")) == "space"
    ind = dec.find(f"{W}pPr/{W}ind")
    assert (val(ind, "left"), val(ind, "firstLine")) == ("0", "709")
    bullet = absn["1"].find(f"{W}lvl")
    assert bullet is not None
    assert val(bullet.find(f"{W}numFmt")) == "bullet"
    assert val(bullet.find(f"{W}lvlText")) == "•"
    nums = {val(n, "numId"): n for n in numbering.findall(f"{W}num")}
    assert val(nums["1"].find(f"{W}lvlOverride/{W}startOverride")) == "4"
    assert val(nums["2"].find(f"{W}abstractNumId")) == "1"
    assert val(nums["3"].find(f"{W}lvlOverride/{W}startOverride")) == "1"


def test_kk_p19a_9_table_layout() -> None:
    data, _ = build(
        doc(
            [
                section("generic", [table([["A", "B"], ["1", "2"]], [100, 100])]),
                section("generic", [table([["x"]], [10], borders="none", header=False)]),
            ]
        )
    )
    tbls = docx_part(data, "word/document.xml").findall(f"{W}body/{W}tbl")
    t = tbls[0]
    assert val(t.find(f"{W}tblPr/{W}tblLayout"), "type") == "fixed"
    assert val(t.find(f"{W}tblPr/{W}tblW"), "w") == "9354"
    cols = [int(val(c, "w") or 0) for c in t.findall(f"{W}tblGrid/{W}gridCol")]
    assert sum(cols) == 9354
    assert cols == [4677, 4677]
    top = t.find(f"{W}tblPr/{W}tblBorders/{W}top")
    assert (val(top), val(top, "sz")) == ("single", "4")
    rows = t.findall(f"{W}tr")
    assert all(r.find(f"{W}trPr/{W}cantSplit") is not None for r in rows)
    assert [r.find(f"{W}trPr/{W}tblHeader") is not None for r in rows] == [True, False]
    cell_p = rows[0].find(f"{W}tc/{W}p")
    assert cell_p is not None
    assert val(ppr(cell_p, "spacing"), "line") == "240"
    assert val(ppr(cell_p, "jc")) == "left"
    assert val(ppr(cell_p, "ind"), "firstLine") == "0"
    assert val(tbls[1].find(f"{W}tblPr/{W}tblBorders/{W}top")) == "nil"
    margin = t.find(f"{W}tblPr/{W}tblCellMar/{W}left")
    assert val(margin, "w") == "108"


# ---------- KK-P19a-11: bölüm kuralları ----------


def test_kk_p19a_11_section_rules() -> None:
    d = doc(
        [
            section("courtHeader", [para(run("MAHKEME"), align="center", indent="none")]),
            section("partiesGrid", [party("DAVACI", "Ayşe Örnek"), party("DAVALI", "Örnek A.Ş.")]),
            section(
                "resultAndRequest",
                [para(run("istem")), para(run("tarih"), align="right", indent="none")],
            ),
            section(
                "attorneySignature",
                [
                    para(run("Vekil"), align="center", indent="none"),
                    para(run("Av. Örnek"), align="center", indent="none"),
                ],
                layout="right_box",
                box=70,
                keep=True,
            ),
        ]
    )
    data, degraded = build(d)
    assert degraded == {}  # DOCX keepTogether'ı taşır
    court, p1, p2, req, date, sig1, sig2 = body_paras(data)
    assert val(ppr(court, "spacing"), "after") == "360"
    assert ppr(court, "spacing") is not None
    assert val(ppr(court, "spacing"), "before") is None
    assert val(ppr(p1, "spacing"), "before") == "240"
    assert ppr(p2, "spacing") is None
    assert val(ppr(req, "spacing"), "before") == "240"
    assert ppr(p1, "keepLines") is not None
    assert ppr(p2, "keepLines") is not None
    assert (val(ppr(p1, "ind"), "left"), val(ppr(p1, "ind"), "hanging")) == ("1701", "1701")
    # imza: sol girinti 95 mm, ortalı; zincir önceki bölümün son paragrafından başlar
    assert ppr(date, "keepNext") is not None
    assert ppr(sig1, "keepNext") is not None
    assert ppr(sig2, "keepNext") is None
    assert ppr(sig1, "keepLines") is not None
    assert ppr(sig2, "keepLines") is not None
    for sig in (sig1, sig2):
        assert (val(ppr(sig, "ind"), "left"), val(ppr(sig, "ind"), "firstLine")) == ("5386", "0")
        assert val(ppr(sig, "jc")) == "center"
    assert val(ppr(sig1, "spacing"), "before") == "240"


def test_kk_p19a_11_header_and_footer_parts() -> None:
    data, _ = build(petition(1), page_numbers=True)
    hdr = docx_part(data, "word/header1.xml")
    hps = hdr.findall(f"{W}p")
    assert [text(p) for p in hps] == [
        "ÖRNEK HUKUK BÜROSU",
        "Örnek Mah. Örnek Cad. No: 1 Örnekşehir",
    ]
    assert all(val(ppr(p, "jc")) == "center" for p in hps)
    assert all(val(p.find(f"{W}r/{W}rPr/{W}sz")) == "20" for p in hps)
    assert hps[0].find(f"{W}r/{W}rPr/{W}b") is not None
    assert hps[1].find(f"{W}r/{W}rPr/{W}b") is None
    ftr = docx_part(data, "word/footer1.xml")
    fld = ftr.find(f"{W}p/{W}fldSimple")
    assert fld is not None
    assert (val(fld, "instr") or "").strip() == "PAGE"
    assert val(ppr(ftr.find(f"{W}p"), "jc")) == "center"  # type: ignore[arg-type]
    nofooter, _ = build(petition(1), page_numbers=False)
    assert "word/footer1.xml" not in docx_names(nofooter)


def test_kk_p19a_10_zip_sorted_fixed_time() -> None:
    data, _ = build(petition(1))
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = zf.namelist()
        assert names == sorted(names)
        assert {i.date_time for i in zf.infolist()} == {(2026, 1, 2, 3, 4, 4)}
        assert {i.external_attr >> 16 for i in zf.infolist()} == {0o600}
