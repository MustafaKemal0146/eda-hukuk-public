"""L2: UDF yazıcı birimleri (084 §2, §4.2, §9.3). @tk TK-15

Kapsanan kabul kriterleri: KK-P19a-1, KK-P19a-2, KK-P19a-3, KK-P19a-4, KK-P19a-5, KK-P19a-6,
KK-P19a-7, KK-P19a-9.

UDF çıktısı gerçek UYAP fixture'larıyla doğrulanmamıştır (IG-10 yok; AS-0300): bu testler yazıcının
084 §2 olgularına ve `profile.py` hipotezlerine uyduğunu sınar, UYAP uyumunu değil.
"""

import io
import zipfile
from decimal import Decimal
from xml.etree.ElementTree import Element

import pytest
from conftest import pool_slice, render, udf_xml
from hypothesis import given, settings
from hypothesis import strategies as st
from samples import brk, doc, heading, para, party, petition, plist, request, run, section, table

from eda_doc_engine.typography import TEXT_WIDTH_PT, emu_to_pt, mm_to_pt
from eda_doc_engine.udf import profile
from eda_doc_engine.udf.writer import argb

PARA_ATTRS = [
    "Alignment",
    "LeftIndent",
    "RightIndent",
    "FirstLineIndent",
    "LineSpacing",
    "SpaceAbove",
    "SpaceBelow",
]
RUN_ATTRS = ["startOffset", "length", "family", "size", "bold", "italic", "underline", "foreground"]


def udf(d: dict[str, object], page_numbers: bool = False) -> tuple[Element, dict[str, int]]:
    data, degraded, _ = render(request(d, "udf", page_numbers=page_numbers))
    return udf_xml(data), degraded


def paragraphs(root: Element) -> list[Element]:
    return list(root.iter("paragraph"))


def para_text(pool: str, p: Element) -> str:
    return "".join(
        pool_slice(pool, int(c.get("startOffset", "0")), int(c.get("length", "0")))
        for c in p
        if c.tag in ("content", "tab")
    )


def body(*blocks: dict[str, object], role: str = "generic") -> dict[str, object]:
    return doc([section(role, list(blocks))])


# ---------- KK-P19a-1: paket ----------


def test_kk_p19a_1_udf_package_single_content_xml() -> None:
    data, _, _ = render(request(petition(2), "udf"))
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        infos = zf.infolist()
        assert [i.filename for i in infos] == ["content.xml"]
        info = infos[0]
        assert info.compress_type == zipfile.ZIP_DEFLATED
        assert info.date_time == (1980, 1, 1, 0, 0, 0)
        assert info.external_attr >> 16 == 0o600
        assert zf.comment == b""
        raw = zf.read("content.xml")
    assert raw.startswith(b'<?xml version="1.0" encoding="UTF-8" ?>')
    raw.decode("utf-8")
    root = udf_xml(data)
    assert root.tag == "template"
    assert root.get("format_id") == "1.8"
    assert [c.tag for c in root] == ["content", "properties", "elements", "styles"]
    assert root.find("elements").get("resolver") == "hvl-default"  # type: ignore[union-attr]


# ---------- KK-P19a-2: ofsetler (UTF-16) ----------


def test_kk_p19a_2_offsets_turkish_and_astral() -> None:
    texts = ["İıĞğŞşÇçÖöÜü", "a\U0001f600b", "\U0001d49c x", "son"]
    root, _ = udf(body(*[para(run(t)) for t in texts]))
    pool = root.findtext("content") or ""
    ps = paragraphs(root)
    assert [para_text(pool, p) for p in ps] == texts
    emoji = ps[1].find("content")
    assert emoji is not None
    assert emoji.get("length") == "4"
    # Ayırıcı modeli (H-1): son paragraftan sonra ayırıcı yok.
    assert not pool.endswith(profile.PARAGRAPH_SEPARATOR)
    assert pool == profile.PARAGRAPH_SEPARATOR.join(texts)


_TEXT = st.text(
    alphabet=st.characters(
        codec="utf-8",
        exclude_categories=("Cs", "Cc", "Cf", "Co", "Cn", "Zl", "Zp"),
        # layout._DROP_CHARS ile eşleşir (So kategorisi)
        exclude_characters=("\ufffc",),
    ),
    min_size=0,
    max_size=30,
)

_RUN = st.builds(
    lambda t, b, i, u: run(t, bold=b, italic=i, underline=u),
    _TEXT,
    st.booleans(),
    st.booleans(),
    st.booleans(),
)


@settings(max_examples=500, deadline=None)
@given(st.lists(st.lists(_RUN, min_size=0, max_size=4), min_size=1, max_size=6))
def test_kk_p19a_2_offsets_property(paras: list[list[dict[str, object]]]) -> None:
    import unicodedata

    root, _ = udf(body(*[para(*rs) for rs in paras]))
    pool = root.findtext("content") or ""
    ps = paragraphs(root)
    assert len(ps) == len(paras)
    cursor = 0
    for p, runs in zip(ps, paras, strict=True):
        expected = "".join(unicodedata.normalize("NFC", str(r["text"])) for r in runs)
        contents = [c for c in p if c.tag == "content"]
        for c in contents:
            start, length = int(c.get("startOffset", "-1")), int(c.get("length", "-1"))
            assert start == cursor  # ardışık, örtüşmesiz
            assert length > 0  # sıfır uzunluklu çalıştırma yazılmaz
            cursor += length
        got = para_text(pool, p)
        assert got == (expected or profile.EMPTY_PARAGRAPH_MARK)
        cursor += len(profile.PARAGRAPH_SEPARATOR.encode("utf-16-le")) // 2
    assert len(pool.encode("utf-16-le")) // 2 == cursor - 1


def test_kk_p19a_2_long_paragraph_200k() -> None:
    text = "ğ" * 200_000
    root, _ = udf(body(para(run(text))))
    c = paragraphs(root)[0].find("content")
    assert c is not None
    assert c.get("length") == "200000"


# ---------- KK-P19a-3: CDATA ve yasak karakterler ----------


def test_kk_p19a_3_cdata_split_and_forbidden_chars() -> None:
    text = "a]]>b\x01c\x0bd\ufffce\u200bf\u202eg\U000e0041h\ufeffi"
    data, degraded, _ = render(request(body(para(run(text))), "udf", page_numbers=False))
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        raw = zf.read("content.xml").decode()
    assert "]]]]><![CDATA[>" in raw
    root = udf_xml(data)  # iyi biçimli
    pool = root.findtext("content")
    assert pool == "a]]>bcdefghi"
    assert degraded == {"forbidden_char": 7}


def test_kk_p19a_3_spaces_and_tabs_preserved() -> None:
    root, _ = udf(body(para(run("  iki  boşluk  ")), para(run("x\ty")), role="generic"))
    pool = root.findtext("content") or ""
    assert pool.split("\n") == ["  iki  boşluk  ", "x y"]  # sekme yalnız taraf/konu rolünde


# ---------- KK-P19a-4: açık öznitelikler ----------


def test_kk_p19a_4_every_paragraph_and_run_explicit() -> None:
    root, _ = udf(petition(3))
    ps = paragraphs(root)
    assert ps
    for p in ps:
        assert list(p.attrib)[: len(PARA_ATTRS)] == PARA_ATTRS
        for c in p.iter("content"):
            assert list(c.attrib) == RUN_ATTRS
            assert c.get("family") == "Times New Roman"
            assert c.get("foreground") == "-16777216"
            assert c.get("bold") in ("true", "false")


# ---------- KK-P19a-5: sayfa biçimi, ARGB, birimler ----------


def test_kk_p19a_5_page_format_and_argb() -> None:
    root, _ = udf(petition(1))
    pf = root.find("properties/pageFormat")
    assert pf is not None
    assert dict(pf.attrib) == {
        "mediaSizeName": "1",
        "leftMargin": "70.866",
        "rightMargin": "56.693",
        "topMargin": "56.693",
        "bottomMargin": "56.693",
        "paperOrientation": "1",
        "headerFOffset": "20.0",
        "footerFOffset": "20.0",
    }
    assert argb(0x000000) == -16777216
    assert argb(0xFFFFFF) == -1
    assert argb(0xFF0000) == -65536
    assert argb(0x333333) == -13421773


@pytest.mark.parametrize(
    ("mm", "pt"),
    [
        (25, "70.866"),
        (20, "56.693"),
        (12.5, "35.433"),
        (30, "85.039"),
        (95, "269.291"),
        (165, "467.717"),
        (70, "198.425"),
    ],
)
def test_kk_p19a_5_mm_to_pt_three_decimals(mm: float, pt: str) -> None:
    assert mm_to_pt(mm) == Decimal(pt)


def test_kk_p19a_5_line_spacing_one_and_half_is_point_five() -> None:
    root, _ = udf(body(para(run("x"))))
    assert paragraphs(root)[0].get("LineSpacing") == "0.5"


# ---------- KK-P19a-6: listeler ----------


def test_kk_p19a_6_lists_level_zero_separate_ids() -> None:
    root, degraded = udf(
        body(
            plist(["bir", "iki"]),
            para(run("ara")),
            plist(["üç"], start=3),
            plist(["madde"], ordered=False),
        )
    )
    ps = paragraphs(root)
    numbered = [p for p in ps if p.get("Numbered") == "true"]
    assert [p.get("ListId") for p in numbered] == ["1", "1", "2"]
    assert all(p.get("ListLevel") == "0" for p in numbered)
    assert {p.get("NumberType") for p in numbered} == {"NUMBER_TYPE_NUMBER_DOT"}
    bullets = [p for p in ps if p.get("Bulleted") == "true"]
    assert [(b.get("BulletType"), b.get("ListId"), b.get("ListLevel")) for b in bullets] == [
        ("BULLET_TYPE_ELLIPSE", "3", "0")
    ]
    raw = str(root.attrib) + "".join(str(p.attrib) for p in ps)
    assert "NUMBER_TRE" not in raw
    assert "PARANTHESE" not in raw
    assert degraded == {"list_start": 1}


def test_kk_p19a_6_list_item_extra_paragraphs_not_numbered() -> None:
    lst = {
        "type": "list",
        "ordered": True,
        "start": 1,
        "items": [
            {
                "paragraphs": [
                    {"align": "justify", "runs": [run("ilk")]},
                    {"align": "justify", "runs": [run("ikinci")]},
                ]
            }
        ],
    }
    root, _ = udf(body(lst))
    ps = paragraphs(root)
    assert ps[0].get("Numbered") == "true"
    assert ps[1].get("Numbered") is None
    assert ps[1].get("FirstLineIndent") == "35.433"


# ---------- KK-P19a-7: tablo ve EMU ----------


def test_kk_p19a_7_table_column_spans_sum() -> None:
    root, _ = udf(body(table([["A", "B", "C"], ["1", "2", "3"]], [50, 60, 100])))
    t = root.find("elements/table")
    assert t is not None
    spans = [Decimal(s) for s in (t.get("columnSpans") or "").split(",")]
    assert sum(spans) == TEXT_WIDTH_PT == Decimal("467.717")
    assert t.get("columnCount") == "3"
    assert t.get("tableName") == "Sabit"
    assert t.get("border") == "borderCell"
    rows = t.findall("row")
    assert [r.get("rowType") for r in rows] == ["headerRow", "dataRow"]
    cell = rows[0].find("cell")
    assert cell is not None
    assert (cell.get("colspan"), cell.get("borderSpec"), cell.get("borderStyle")) == (
        "1",
        "15",
        "solid",
    )
    cp = cell.find("paragraph")
    assert cp is not None
    assert (cp.get("LineSpacing"), cp.get("Alignment"), cp.get("FirstLineIndent")) == (
        "0.0",
        "0",
        "0.0",
    )


def test_kk_p19a_7_table_without_borders_and_emu() -> None:
    root, _ = udf(body(table([["a", "b"]], [80, 80], borders="none", header=False)))
    cell = root.find("elements/table/row/cell")
    assert cell is not None
    assert cell.get("border") == "borderNone"
    assert emu_to_pt(2_520_000) == Decimal("198.425")


# ---------- KK-P19a-9: 084 §4.2 eşleme satırları ve bozulma sayımı ----------


def test_kk_p19a_9_degraded_counts_and_text_kept() -> None:
    d = doc(
        [
            section(
                "generic",
                [
                    para(
                        run("çizik", strike=True),
                        run(" bağ", href="https://example.invalid/x"),
                        brk(),
                        run("sonra"),
                    ),
                    plist(["beş"], start=5),
                ],
            ),
            section(
                "attorneySignature",
                [para(run("İmza"), align="center", indent="none")],
                layout="right_box",
                box=70,
                keep=True,
            ),
        ]
    )
    root, degraded = udf(d, page_numbers=True)
    assert degraded == {
        "hard_break_as_paragraph": 1,
        "hyperlink": 1,
        "keep_together": 1,
        "list_start": 1,
        "page_number": 1,
        "strike": 1,
    }
    pool = root.findtext("content") or ""
    assert pool.split("\n")[:2] == ["çizik bağ", "sonra"]
    ps = paragraphs(root)
    # break sonrası parça: aynı biçim, FirstLineIndent 0, SpaceAbove 0
    assert ps[1].get("FirstLineIndent") == "0.0"
    assert ps[1].get("SpaceAbove") == "0.0"
    assert ps[0].get("FirstLineIndent") == "35.433"
    sig = ps[-1]
    assert (sig.get("LeftIndent"), sig.get("Alignment"), sig.get("FirstLineIndent")) == (
        "269.291",
        "1",
        "0.0",
    )
    assert root.find("elements/footer") is None  # H-14: sayfa numarası yazılmaz


def test_kk_p19a_9_alignment_heading_hanging_tab_and_sections() -> None:
    d = doc(
        [
            section(
                "courtHeader", [para(run("MAHKEME", bold=True), align="center", indent="none")]
            ),
            section("partiesGrid", [party("DAVACI", "Ayşe Örnek")]),
            section(
                "generic",
                [
                    heading("BAŞLIK"),
                    para(run("sol"), align="left"),
                    para(run("sağ"), align="right", indent="none"),
                    para(run("tab\tyok")),
                ],
            ),
        ],
        header=["ÖRNEK BÜRO", "", "Adres"],
    )
    root, _ = udf(d)
    pool = root.findtext("content") or ""
    assert pool.split("\n") == [
        "ÖRNEK BÜRO",
        "Adres",
        "MAHKEME",
        "DAVACI\t: Ayşe Örnek",
        "BAŞLIK",
        "sol",
        "sağ",
        "tab yok",
    ]
    hdr = root.findall("elements/header/paragraph")
    assert [h.find("content").get("size") for h in hdr] == ["10", "10"]  # type: ignore[union-attr]
    assert [h.find("content").get("bold") for h in hdr] == ["true", "false"]  # type: ignore[union-attr]
    ps = root.findall("elements/paragraph")
    court, party_p, head, left, right, _tab = ps
    assert (court.get("Alignment"), court.get("SpaceBelow")) == ("1", "18.0")
    assert party_p.get("SpaceAbove") == "12.0"
    assert (party_p.get("LeftIndent"), party_p.get("FirstLineIndent"), party_p.get("TabSet")) == (
        "85.039",
        "-85.039",
        "85.039:0:0",
    )
    tab = party_p.find("tab")
    assert tab is not None
    assert pool_slice(pool, int(tab.get("startOffset", "0")), 1) == "\t"
    assert head.get("Alignment") == "0"
    assert head.find("content").get("bold") == "true"
    assert head.get("SpaceAbove") == "12.0"
    assert left.get("Alignment") == "0"
    assert right.get("Alignment") == "2"
    assert right.get("FirstLineIndent") == "0.0"


def test_kk_p19a_9_empty_paragraph_is_zwsp_and_title_not_written() -> None:
    root, _ = udf(doc([section("generic", [para(), para(run("x"))])], title="GİZLİ BAŞLIK"))
    pool = root.findtext("content") or ""
    assert pool == "\u200b\nx"
    first = paragraphs(root)[0].find("content")
    assert first is not None
    assert first.get("length") == "1"
    assert "GİZLİ BAŞLIK" not in pool


def test_kk_p19a_9_styles_written_but_not_relied_on() -> None:
    root, _ = udf(petition(1))
    styles = root.findall("styles/style")
    assert [s.get("name") for s in styles] == ["default", "hvl-default"]
    assert all(s.get("family") == "Times New Roman" and s.get("size") == "12" for s in styles)
