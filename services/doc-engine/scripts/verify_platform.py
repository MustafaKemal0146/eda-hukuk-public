"""Tek seferlik platform doğrulaması (P19a.4; KK-P19a-18). Uç YAZMAZ; sonuçlar AS kaydına girer.

Her denetim bir JSON satırı yazar: `{"key", "status": "pass"|"fail", "detail"}`. Denetimler farklı
konteynırlarda koşar (`verify_platform.sh` düzenler):

- doğrulama imajı (`verify-platform.Dockerfile`: Python 3.14 + Docling + OCRmyPDF + Tesseract):
  `wheels-py314`, `docling-model-licenses` (ağlı), `ocrmypdf-without-ghostscript` (ağsız),
  `turkish-text-layer` ve `tmpfs-noexec` (ağsız, modeller salt-okur birimde);
- doc-engine geliştirme imajı (iç ağda Gotenberg ile): `make-turkish-pdf`,
  `gotenberg-flags-and-fields`, `gotenberg-liberation-serif`.

Girdiler SENTETİKTİR. Bu betik doc-engine çalışma zamanına girmez.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

TURKISH = "İıĞğŞşÇçÖöÜü"
SAMPLE_LINE = f"ÖRNEK İSTANBUL ISPARTA ığüşöç {TURKISH}"
ALLOWED_MODEL_LICENSES = {"mit", "apache-2.0", "bsd-3-clause", "bsd-2-clause", "cc0-1.0"}
DOCLING_REPOS = [
    "docling-project/docling-layout-heron",
    "docling-project/docling-models",
    "docling-project/TableFormerV2",
    "docling-project/CodeFormulaV2",
    "docling-project/DocumentFigureClassifier-v2.5",
]
GOTENBERG = "http://gotenberg:3000"


@dataclass(frozen=True)
class Check:
    key: str
    run: Callable[[list[str]], tuple[bool, Any]]


def emit(key: str, ok: bool, detail: Any) -> None:
    print(
        json.dumps(
            {"key": key, "status": "pass" if ok else "fail", "detail": detail}, ensure_ascii=False
        )
    )


# ---- 1: Python 3.14 tekerlekleri ----


def wheels(_args: list[str]) -> tuple[bool, Any]:
    import importlib.metadata as md

    names = [
        "docling",
        "docling-parse",
        "docling-ibm-models",
        "ocrmypdf",
        "pikepdf",
        "torch",
        "pypdfium2",
        "pillow",
    ]
    versions = {n: md.version(n) for n in names}
    # İmaj `uv pip install --only-binary :all:` ile kuruldu: kaynaktan derleme yoktur.
    return sys.version_info[:2] == (3, 14), {"python": sys.version.split()[0], **versions}


# ---- 2: Docling model kartı lisansları ----


def model_licenses(_args: list[str]) -> tuple[bool, Any]:
    result: dict[str, str] = {}
    for repo in DOCLING_REPOS:
        url = f"https://huggingface.co/api/models/{repo}"
        with urllib.request.urlopen(url, timeout=30) as r:
            info = json.load(r)
        tags = [t.split(":", 1)[1] for t in info.get("tags", []) if t.startswith("license:")]
        card = (info.get("cardData") or {}).get("license")
        result[repo] = str(card or (tags[0] if tags else "bilinmiyor"))
    ok = all(v.casefold() in ALLOWED_MODEL_LICENSES for v in result.values())
    return ok, result


# ---- 3: Ghostscript'siz OCRmyPDF ----


def _scanned_pdf(path: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype(
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf", 48
    )
    img = Image.new("L", (2480, 600), 255)  # 300 dpi A4 genişliği
    draw = ImageDraw.Draw(img)
    draw.text((120, 120), SAMPLE_LINE, font=font, fill=0)
    draw.text((120, 300), "Örnek dilekçe metni; taranmış sentetik sayfa.", font=font, fill=0)
    img.save(path, "PDF", resolution=300.0)


def ocr_without_gs(_args: list[str]) -> tuple[bool, Any]:
    import pypdfium2

    detail: dict[str, Any] = {"gs_on_path": shutil.which("gs") is not None}
    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp) / "scan.pdf", Path(tmp) / "ocr.pdf"
        _scanned_pdf(src)
        runs = {
            "pdf": ["--output-type", "pdf"],
            "pdfa-internal": ["--output-type", "pdfa", "--pdfa-backend", "internal"],
        }
        texts: dict[str, str] = {}
        for name, flags in runs.items():
            proc = subprocess.run(  # noqa: S603 - sabit argümanlar
                [
                    "/opt/verify/bin/ocrmypdf",
                    "-l",
                    "tur+eng",
                    "--max-ocr-image-mpixels",
                    "50",
                    *flags,
                    str(src),
                    str(out),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            detail[f"{name}_exit"] = proc.returncode
            if proc.returncode != 0:
                detail[f"{name}_stderr_tail"] = proc.stderr.strip().splitlines()[-3:]
                continue
            pdf = pypdfium2.PdfDocument(str(out))
            texts[name] = pdf[0].get_textpage().get_text_range()
        detail["ocr_text_pdf"] = texts.get("pdf", "")[:200]
        detail["turkish_chars_recognised"] = sorted(
            {c for c in TURKISH if c in texts.get("pdf", "")}
        )
    ok = not detail["gs_on_path"] and detail.get("pdf_exit") == 0
    return ok, detail


# ---- 4 ve 7: Docling ile Türkçe metin katmanı (OCR KAPALI), tmpfs noexec ----


def turkish_text_layer(args: list[str]) -> tuple[bool, Any]:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pdf, models = Path(args[0]), Path(args[1])
    options = PdfPipelineOptions(artifacts_path=str(models), do_ocr=False)
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )
    text = converter.convert(pdf).document.export_to_markdown()
    missing = [c for c in TURKISH if c not in text]
    return not missing and SAMPLE_LINE in text, {"missing": missing, "excerpt": text[:300]}


# ---- 5 ve 6: Gotenberg (doc-engine geliştirme imajında, iç ağda) ----


def make_turkish_pdf(args: list[str]) -> tuple[bool, Any]:
    import asyncio

    from eda_doc_engine.pdf.checks import inspect_pdf
    from eda_doc_engine.pdf.gotenberg import GotenbergClient

    pdf = asyncio.run(GotenbergClient(GOTENBERG).convert_docx(_sample_docx()))
    Path(args[0]).write_bytes(pdf)
    facts = inspect_pdf(pdf)
    return facts.page_count == 1, {"fonts": facts.fonts, "bytes": len(pdf)}


def _sample_docx() -> bytes:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
    from samples import doc, para, request, run, section

    from eda_doc_engine.export import render_bytes
    from eda_doc_engine.models.generated.export_schema import ExportRequest

    d = doc([section("generic", [para(run(SAMPLE_LINE)), para(run("Örnek ikinci satır."))])])
    return render_bytes(ExportRequest.model_validate(request(d, "docx")))[0]


def gotenberg_flags(_args: list[str]) -> tuple[bool, Any]:
    import httpx2

    from eda_doc_engine.pdf.gotenberg import CONVERT_PATH, FORM_FIELDS

    detail: dict[str, Any] = {}
    files = {"files": ("document.docx", _sample_docx(), "application/octet-stream")}
    with httpx2.Client(base_url=GOTENBERG, timeout=120, trust_env=False) as c:
        detail["version"] = c.get("/version").text.strip()
        # Denetim: doc-engine'in gönderdiği alanlarla geçerli DOCX 200 döner.
        detail["control_doc_engine_fields"] = c.post(
            CONVERT_PATH, data=FORM_FIELDS, files=files
        ).status_code
        for field in (*FORM_FIELDS, "pdfa"):
            # Aynı geçerli DOCX + tanınan alanda biçimsiz değer -> 400 (alan adı doğrulaması).
            r = c.post(CONVERT_PATH, data={field: "biçimsiz"}, files=files)
            detail[f"field_{field}"] = r.status_code
        detail["chromium_url_route"] = c.post(
            "/forms/chromium/convert/url", data={"url": "http://example.invalid"}
        ).status_code
        detail["download_from"] = c.post(
            CONVERT_PATH,
            files={"downloadFrom": (None, json.dumps([{"url": "http://gotenberg:3000/health"}]))},
        ).status_code
    fields_ok = all(v == 400 for k, v in detail.items() if k.startswith("field_"))
    ok = (
        fields_ok
        and detail["control_doc_engine_fields"] == 200
        and detail["chromium_url_route"] == 404
        and detail["download_from"] == 400
    )
    return ok and detail["version"].startswith("8.37."), detail


def gotenberg_liberation(args: list[str]) -> tuple[bool, Any]:
    from eda_doc_engine.pdf.checks import inspect_pdf

    facts = inspect_pdf(Path(args[0]).read_bytes())
    embedded = sorted(n for n, e in facts.fonts.items() if e and n.startswith("LiberationSerif"))
    return bool(embedded), {"embedded": embedded}


CHECKS = [
    Check("wheels-py314", wheels),
    Check("docling-model-licenses", model_licenses),
    Check("ocrmypdf-without-ghostscript", ocr_without_gs),
    Check("turkish-text-layer", turkish_text_layer),
    Check("gotenberg-flags-and-fields", gotenberg_flags),
    Check("gotenberg-liberation-serif", gotenberg_liberation),
    Check("tmpfs-noexec", turkish_text_layer),
]
HELPERS = {"make-turkish-pdf": make_turkish_pdf}


def main(argv: list[str]) -> int:
    key, args = argv[1], argv[2:]
    runner = {c.key: c.run for c in CHECKS} | HELPERS
    try:
        ok, detail = runner[key](args)
    except Exception as exc:
        ok, detail = False, {"error": f"{type(exc).__name__}: {str(exc)[:300]}"}
    emit(key, ok, detail)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
