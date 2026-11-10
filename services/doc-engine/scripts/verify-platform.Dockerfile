# syntax=docker/dockerfile:1.7
# Tek seferlik platform doğrulama imajı (P19a.4). Üretim imajı DEĞİLDİR; doc-engine bağımlılığı olarak
# kilitlenmez. Docling/OCRmyPDF/Tesseract P20'de üretim imajına girer; burada yalnız Python 3.14
# tekerlekleri, Ghostscript'siz OCR ve Türkçe metin katmanı ölçülür. Ghostscript KURULMAZ.
FROM ghcr.io/astral-sh/uv:0.12.24@sha256:3af4716e991d6956a41e573eab705d0ee08500cd829ed30293eb8472f372c65a AS uv

FROM python:3.14-slim-trixie@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170
COPY --from=uv /uv /usr/local/bin/
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-tur tesseract-ocr-eng \
    fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
ENV UV_PYTHON_DOWNLOADS=never VIRTUAL_ENV=/opt/verify PATH=/opt/verify/bin:$PATH
ARG DOCLING_VERSION=2.133.0
ARG OCRMYPDF_VERSION=17.13.0
ARG PIKEPDF_VERSION=10.16.0
RUN uv venv /opt/verify \
 && uv pip install --only-binary :all: \
    --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match \
    "docling==${DOCLING_VERSION}" "ocrmypdf==${OCRMYPDF_VERSION}" "pikepdf==${PIKEPDF_VERSION}"
