"""SENTETİK DocAST örnekleri (gerçek kişi, kurum, künye yoktur; "Örnek" ön eki)."""

import copy
import uuid
from typing import Any

JOB_ID = "0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f70"
FIXED_TS = "2026-01-02T03:04:05Z"

Json = dict[str, Any]

_FILLER = (
    "Örnek taraflar arasında düzenlenen örnek sözleşme gereğince örnek edimlerin zamanında "
    "yerine getirilmesi kararlaştırılmış, ancak örnek davalı tarafından bu yükümlülük örnek "
    "süre içinde yerine getirilmemiştir. Örnek ihtarname gönderilmiş, örnek yanıt alınamamıştır."
)


def run(text: str, **flags: Any) -> Json:
    base = {
        "kind": "text",
        "text": text,
        "bold": False,
        "italic": False,
        "underline": False,
        "strike": False,
        "href": None,
    }
    base.update(flags)
    return base


def brk() -> Json:
    return {"kind": "break"}


def para(
    *runs: Json,
    align: str = "justify",
    indent: str = "first_line",
    hanging: float | None = None,
    tabs: list[float] | None = None,
) -> Json:
    return {
        "type": "paragraph",
        "align": align,
        "indent": indent,
        "hangingMm": hanging,
        "tabStopsMm": tabs if tabs is not None else [],
        "runs": list(runs),
    }


def heading(text: str, level: int = 1) -> Json:
    return {"type": "heading", "level": level, "align": "left", "runs": [run(text, bold=True)]}


def plist(items: list[str], ordered: bool = True, start: int = 1) -> Json:
    return {
        "type": "list",
        "ordered": ordered,
        "start": start,
        "items": [{"paragraphs": [{"align": "justify", "runs": [run(t)]}]} for t in items],
    }


def table(
    rows: list[list[str]], widths: list[float], borders: str = "grid", header: bool = True
) -> Json:
    return {
        "type": "table",
        "borders": borders,
        "columnWidthsMm": widths,
        "rows": [
            {
                "cells": [
                    {
                        "header": header and r == 0,
                        "paragraphs": [{"align": "left", "runs": [run(c)]}],
                    }
                    for c in row
                ]
            }
            for r, row in enumerate(rows)
        ],
    }


def section(
    role: str,
    blocks: list[Json],
    layout: str = "flow",
    box: float | None = None,
    keep: bool = False,
) -> Json:
    return {
        "id": f"b-{uuid.uuid5(uuid.NAMESPACE_OID, role + str(len(blocks))).hex[:6]}",
        "role": role,
        "blocks": blocks,
        "layout": layout,
        "boxWidthMm": box,
        "keepTogether": keep,
    }


def doc(
    sections: list[Json],
    header: list[str] | None = None,
    title: str = "Örnek dilekçe",
    kind: str = "petition",
) -> Json:
    return {
        "schemaVersion": 1,
        "kind": kind,
        "title": title,
        "page": {"size": "A4", "marginsMm": {"top": 20, "bottom": 20, "left": 25, "right": 20}},
        "typography": {
            "fontFamily": "Liberation Serif",
            "sizePt": 12,
            "noteSizePt": 10,
            "lineHeight": 1.5,
            "firstLineIndentCm": 1.25,
            "justify": True,
            "hyphenate": False,
        },
        "header": {"lines": header} if header is not None else None,
        "sections": sections,
    }


def party(label: str, value: str) -> Json:
    return para(
        run(label, bold=True),
        run(f"\t: {value}"),
        align="left",
        indent="hanging",
        hanging=30,
        tabs=[30],
    )


def petition(explanations: int = 9, filler: str = _FILLER) -> Json:
    """8 bloklu sentetik dava dilekçesi (084 §5.2 rol sırası; >= 3 sayfa)."""
    return doc(
        [
            section(
                "courtHeader",
                [
                    para(
                        run("ÖRNEK NÖBETÇİ ASLİYE HUKUK MAHKEMESİNE", bold=True),
                        align="center",
                        indent="none",
                    )
                ],
            ),
            section(
                "partiesGrid",
                [
                    party("DAVACI", "Ayşe Örnek"),
                    party("VEKİLİ", "Av. Örnek Avukat, Örnek Hukuk Bürosu"),
                    party("DAVALI", "Örnek Ticaret A.Ş."),
                ],
            ),
            section("subjectLine", [party("KONU", "Örnek alacağın tahsili talebidir.")]),
            section(
                "numberedExplanations",
                [
                    heading("AÇIKLAMALAR"),
                    plist([f"{filler} ({i + 1})" for i in range(explanations)]),
                ],
            ),
            section(
                "legalGrounds",
                [heading("HUKUKİ SEBEPLER"), para(run("Örnek kanun ve ilgili örnek mevzuat."))],
            ),
            section(
                "evidenceList",
                [heading("DELİLLER"), plist(["Örnek sözleşme", "Örnek ihtarname", "Tanık"])],
            ),
            section(
                "resultAndRequest",
                [
                    heading("SONUÇ VE İSTEM"),
                    para(run(filler)),
                    para(run("01.01.2026"), align="right", indent="none"),
                ],
            ),
            section(
                "attorneySignature",
                [
                    para(run("Davacı Vekili"), align="center", indent="none"),
                    para(run("Av. Örnek Avukat"), align="center", indent="none"),
                    para(run("İmza \u2013 Kaşe"), align="center", indent="none"),
                ],
                layout="right_box",
                box=70,
                keep=True,
            ),
        ],
        header=["ÖRNEK HUKUK BÜROSU", "Örnek Mah. Örnek Cad. No: 1 Örnekşehir"],
    )


def request(
    docast: Json, fmt: str = "udf", page_numbers: bool = True, fixed: str | None = FIXED_TS
) -> Json:
    return {
        "jobId": JOB_ID,
        "format": fmt,
        "docAst": copy.deepcopy(docast),
        "options": {"pageNumbers": page_numbers, "fixedTimestamp": fixed},
    }
