"""Determinizm: aynı DocAST + `fixedTimestamp` -> aynı SHA-256, iki AYRI süreçte (084 İ3, D8;
KK-P19a-8). @tk TK-15"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import render
from samples import petition, request

_SRC = str(Path(__file__).resolve().parents[1] / "src")
_SCRIPT = """
import hashlib, json, sys
from eda_doc_engine.export import render_bytes
from eda_doc_engine.models.generated.export_schema import ExportRequest
req = ExportRequest.model_validate_json(sys.stdin.read())
print(hashlib.sha256(render_bytes(req)[0]).hexdigest())
"""


def _hash_in_subprocess(req: dict[str, object], seed: str) -> str:
    env = {"PYTHONPATH": _SRC, "PYTHONHASHSEED": seed, "PATH": "/usr/bin:/bin"}
    out = subprocess.run(  # noqa: S603 - sabit betik, sabit yorumlayıcı
        [sys.executable, "-c", _SCRIPT],
        input=json.dumps(req),
        capture_output=True,
        text=True,
        check=True,
        env=env,
    )
    return out.stdout.strip()


@pytest.mark.parametrize("fmt", ["udf", "docx"])
def test_kk_p19a_8_same_hash_in_two_processes(fmt: str) -> None:
    req = request(petition(4), fmt)
    first = _hash_in_subprocess(req, "1")
    second = _hash_in_subprocess(req, "2")
    local = hashlib.sha256(render(req)[0]).hexdigest()
    assert first == second == local


def test_kk_p19a_8_docx_timestamp_changes_bytes_udf_does_not() -> None:
    a = request(petition(1), "docx", fixed="2026-01-02T03:04:05Z")
    b = request(petition(1), "docx", fixed="2027-01-02T03:04:05Z")
    assert render(a)[0] != render(b)[0]
    ua = request(petition(1), "udf", fixed="2026-01-02T03:04:05Z")
    ub = request(petition(1), "udf", fixed=None)
    assert render(ua)[0] == render(ub)[0]  # UDF zaman damgası sabit 1980-01-01
