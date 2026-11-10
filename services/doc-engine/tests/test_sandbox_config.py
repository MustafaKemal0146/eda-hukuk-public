"""Alt süreç sınırları ve zaman aşımı (033 §7.5), env doğrulaması (002 §5.7), Bearer dosyası
(KK-P19a-17). @tk TK-15"""

import asyncio
import json
import resource
import time
from pathlib import Path

import pytest
from conftest import settings

from eda_doc_engine import limits
from eda_doc_engine.config import ConfigError, load_settings
from eda_doc_engine.main import check_prerequisites
from eda_doc_engine.sandbox.child import LIMITS
from eda_doc_engine.sandbox.runner import (
    SandboxError,
    SandboxTimeout,
    clean_env,
    create_job_dir,
    remove_job_dir,
    run_task,
)
from eda_doc_engine.security import BearerVerifier, load_token

VALID_ENV = {
    "DOC_ENGINE_PORT": "8002",
    "DOC_ENGINE_TOKEN_FILE": "/run/secrets/doc_engine_token",
    "GOTENBERG_URL": "http://gotenberg:3000",
    "OCR_LANGS": "tur+eng",
    "MAX_UPLOAD_MB": "50",
    "MAX_PAGES": "500",
    "OCR_BATCH_PAGES": "20",
    "DOCLING_ARTIFACTS_PATH": "/opt/models",
    "HF_HUB_OFFLINE": "1",
    "DOC_ENGINE_CONCURRENCY": "1",
    "SUBPROCESS_TIMEOUT_SEC": "300",
}


def probe(job: Path, payload: dict[str, object], timeout: float = 30) -> dict[str, object]:
    out = asyncio.run(run_task("probe", json.dumps(payload).encode(), job, timeout))
    result: dict[str, object] = json.loads(out.stdout)
    return result


def test_kk_p19a_17_subprocess_rlimits_cwd_and_clean_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DOC_ENGINE_TOKEN_FILE", "/run/secrets/doc_engine_token")
    monkeypatch.setenv("GOTENBERG_URL", "http://gotenberg:3000")
    job = create_job_dir(tmp_path)
    assert job.stat().st_mode & 0o777 == 0o700
    assert job.name.startswith("job-")
    result = probe(job, {})
    expected = {}
    for kind, value in LIMITS:
        hard = resource.getrlimit(kind)[1]
        expected[str(kind)] = value if hard == resource.RLIM_INFINITY else min(value, hard)
    assert result["limits"] == expected
    assert expected[str(resource.RLIMIT_AS)] == 3 * 1024**3
    assert expected[str(resource.RLIMIT_CPU)] == limits.RLIMIT_CPU_SEC == 300
    assert expected[str(resource.RLIMIT_CORE)] == 0
    assert result["cwd"] == str(job)
    assert result["envKeys"] == sorted(clean_env(job))
    remove_job_dir(job)
    assert not job.exists()


def test_kk_p19a_17_subprocess_wall_clock_timeout(tmp_path: Path) -> None:
    job = create_job_dir(tmp_path)
    started = time.monotonic()
    with pytest.raises(SandboxTimeout):
        probe(job, {"sleepSec": 30}, timeout=0.5)
    assert time.monotonic() - started < 10


def test_kk_p19a_17_unknown_task_rejected(tmp_path: Path) -> None:
    with pytest.raises(SandboxError):
        asyncio.run(run_task("os.system", b"", create_job_dir(tmp_path), 10))


def test_kk_p19a_17_config_valid() -> None:
    s = load_settings(VALID_ENV)
    assert (s.port, s.concurrency, s.subprocess_timeout_sec, s.max_body_bytes) == (
        8002,
        1,
        300,
        50 * 1024 * 1024,
    )
    assert s.gotenberg_url == "http://gotenberg:3000"
    assert s.hf_hub_offline is True


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"GOTENBERG_URL": ""}, "eksik değişken: GOTENBERG_URL"),
        ({"DOC_ENGINE_TOKEN": "x"}, "bilinmeyen değişken: DOC_ENGINE_TOKEN"),
        ({"DOC_ENGINE_PORT": "0"}, "DOC_ENGINE_PORT"),
        ({"DOC_ENGINE_CONCURRENCY": "bir"}, "DOC_ENGINE_CONCURRENCY"),
        ({"GOTENBERG_URL": "http://u:p@gotenberg:3000"}, "GOTENBERG_URL"),
        ({"GOTENBERG_URL": "http://gotenberg:3000/forms?x=1"}, "GOTENBERG_URL"),
        ({"GOTENBERG_URL": "file:///etc/passwd"}, "GOTENBERG_URL"),
        ({"HF_HUB_OFFLINE": "yes"}, "HF_HUB_OFFLINE"),
        ({"OCR_LANGS": "tur;rm"}, "OCR_LANGS"),
        ({"DOCLING_ARTIFACTS_PATH": "models"}, "DOCLING_ARTIFACTS_PATH"),
    ],
)
def test_kk_p19a_17_config_rejects(patch: dict[str, str], message: str) -> None:
    env = {**VALID_ENV, **patch}
    with pytest.raises(ConfigError, match=message):
        load_settings(env)


def test_kk_p19a_17_token_file_and_constant_time_verify(tmp_path: Path) -> None:
    short = tmp_path / "short"
    short.write_text("kisa")
    with pytest.raises(ConfigError):
        load_token(short)
    with pytest.raises(ConfigError):
        load_token(tmp_path / "yok")
    good = tmp_path / "token"
    good.write_text("A" * 43 + "\n")
    token = load_token(good)
    verifier = BearerVerifier(token)
    assert verifier.verify("Bearer " + "A" * 43)
    assert verifier.verify("bearer " + "A" * 43)
    assert not verifier.verify("Bearer " + "A" * 42)
    assert not verifier.verify("Bearer " + "Ä" * 43)
    assert not verifier.verify(None)


def test_kk_p01c_2_fail_fast_on_missing_models(tmp_path: Path) -> None:
    missing_cfg = settings(docling_artifacts_path=tmp_path / "nonexistent")
    with pytest.raises(RuntimeError, match="Docling model dizini bulunamadı"):
        check_prerequisites(missing_cfg)


def test_kk_p01c_2_fail_fast_on_missing_tesseract_lang() -> None:
    bad_lang_cfg = settings(ocr_langs="tur+xyz")
    with pytest.raises(RuntimeError, match="tesseract dili eksik: xyz"):
        check_prerequisites(bad_lang_cfg)
