"""DocAST yazıcı değişmezleri D1-D10 (084 §3.2; KK-P19a-12). @tk TK-15"""

import io
import zipfile
from typing import Any

import pytest
from conftest import render
from pydantic import ValidationError
from samples import doc, para, petition, plist, request, run, section, table

from eda_doc_engine.errors import ForbiddenPhrase, InvalidDocAst
from eda_doc_engine.layout import TextRun, build_layout
from eda_doc_engine.models.generated.docast_schema import DocAst


def layout_of(d: dict[str, Any]):  # type: ignore[no-untyped-def]
    return build_layout(DocAst.model_validate(d))


def body(*blocks: dict[str, Any], role: str = "generic", **kw: Any) -> dict[str, Any]:
    return doc([section(role, list(blocks), **kw)])


def all_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return "".join(zf.read(n).decode("utf-8") for n in zf.namelist())


def test_kk_p19a_12_d1_schema_version_and_extra_fields() -> None:
    bad = petition(1)
    bad["schemaVersion"] = 2
    with pytest.raises(ValidationError):
        DocAst.model_validate(bad)
    extra = petition(1)
    extra["sections"][0]["blocks"][0]["runs"][0]["color"] = "red"
    with pytest.raises(ValidationError):
        DocAst.model_validate(extra)


@pytest.mark.parametrize(
    "block",
    [
        para(run("x"), indent="hanging", hanging=None, tabs=[30]),
        para(run("x"), indent="none", hanging=30, tabs=[30]),
        para(run("x"), indent="hanging", hanging=30, tabs=[25]),
        para(run("x"), indent="hanging", hanging=-5, tabs=[-5]),
        para(run("x"), indent="first_line", tabs=[float("nan")]),
    ],
)
def test_kk_p19a_12_d2_hanging_invariants(block: dict[str, Any]) -> None:
    with pytest.raises(InvalidDocAst):
        layout_of(body(block))


def test_kk_p19a_12_d3_table_cells_and_scaling() -> None:
    bad = table([["a", "b"]], [80, 80])
    bad["rows"][0]["cells"].pop()
    with pytest.raises(InvalidDocAst):
        layout_of(body(bad))
    with pytest.raises(InvalidDocAst):
        layout_of(body(table([["a"]], [0])))
    lay = layout_of(body(table([["a", "b"]], [200, 100])))
    t = lay.sections[0].blocks[0]
    assert sum(t.widths_mm) == pytest.approx(165)  # type: ignore[union-attr]
    assert t.widths_mm[0] == pytest.approx(110)  # type: ignore[union-attr]


@pytest.mark.parametrize("box", [None, 0, 200, float("inf")])
def test_kk_p19a_12_d4_right_box_width(box: float | None) -> None:
    with pytest.raises(InvalidDocAst):
        layout_of(body(para(run("x")), layout="right_box", box=box))


def test_kk_p19a_12_d4_negative_list_start() -> None:
    with pytest.raises(InvalidDocAst):
        layout_of(body(plist(["x"], start=-1)))


def test_kk_p19a_12_d5_invisible_and_control_chars_removed() -> None:
    lay = layout_of(body(para(run("a\x00b\u202ec\U000e0067d\u00ade\u200bf"))))
    p = lay.sections[0].blocks[0]
    assert [r.text for r in p.runs if isinstance(r, TextRun)] == ["abcdef"]  # type: ignore[union-attr]
    assert lay.forbidden_chars == 5


@pytest.mark.parametrize(
    "phrase",
    [
        "Bu belge e-imzalıdır.",
        "Bu belge E-İMZALIDIR.",
        "BU BELGE E-IMZALIDIR",
        "eimzalidir",
        "Elektronik olarak imzalanmıştır.",
        "ELEKTRONİK OLARAK İMZALANMIŞTIR",
        "e\u2011imzalıdır",
    ],
)
def test_kk_p19a_12_d6_forbidden_phrase_rejected(phrase: str) -> None:
    with pytest.raises(ForbiddenPhrase):
        layout_of(body(para(run(phrase))))


def test_kk_p19a_12_d6_phrase_split_across_runs_title_and_header() -> None:
    with pytest.raises(ForbiddenPhrase):
        layout_of(body(para(run("e-"), run("imza", bold=True), run("lıdır"))))
    d = petition(1)
    d["title"] = "e-imzalıdır"
    with pytest.raises(ForbiddenPhrase):
        layout_of(d)
    d = petition(1)
    d["header"] = {"lines": ["Elektronik olarak imzalanmıştır"]}
    with pytest.raises(ForbiddenPhrase):
        layout_of(d)


def test_kk_p19a_12_no_output_contains_signature_phrase() -> None:
    import re

    pattern = re.compile(r"e-?imzal[ıi]d[ıi]r|elektronik olarak imzalanm", re.IGNORECASE)
    for fmt in ("udf", "docx"):
        data, _, _ = render(request(petition(2), fmt))
        assert not pattern.search(all_text(data))


def test_kk_p19a_12_d7_href_protocols() -> None:
    lay = layout_of(
        body(
            para(
                run("a", href="https://x.invalid"),
                run("b", href="MAILTO:x@y"),
                run("c", href="http://x.invalid"),
                run("d", href="file:///etc"),
            )
        )
    )
    runs = [r for r in lay.sections[0].blocks[0].runs if isinstance(r, TextRun)]  # type: ignore[union-attr]
    assert [r.href for r in runs] == ["https://x.invalid", "MAILTO:x@y", None, None]
    assert lay.demoted_links == 2


def test_kk_p19a_12_d9_nfc_and_d10_header_lines() -> None:
    d = body(para(run("s\u0327")))
    d["header"] = {"lines": ["  ", "Büro", "", "Adres"]}
    lay = layout_of(d)
    run0 = lay.sections[0].blocks[0].runs[0]  # type: ignore[union-attr]
    assert isinstance(run0, TextRun)
    assert run0.text == "ş"
    assert lay.header_lines == ["Büro", "Adres"]


def test_kk_p19a_12_newline_in_text_becomes_break() -> None:
    lay = layout_of(body(para(run("a\r\nb"))))
    kinds = [type(r).__name__ for r in lay.sections[0].blocks[0].runs]  # type: ignore[union-attr]
    assert kinds == ["TextRun", "LineBreak", "TextRun"]


def test_kk_p19a_12_empty_sections_skipped() -> None:
    lay = layout_of(doc([section("generic", []), section("generic", [para(run("x"))])]))
    assert len(lay.sections) == 1
    assert lay.sections[0].blocks[0].space_before_pt == 0  # type: ignore[union-attr]
