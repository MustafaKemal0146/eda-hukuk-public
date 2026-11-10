"""HTTP uçları (084 §7; P19a.12): Bearer, dışa aktarım akışı, hata kodları, eşzamanlılık 1
(KK-P19a-12, KK-P19a-13, KK-P19a-17). @tk TK-15"""

import asyncio
import hashlib
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx2
import pytest
from conftest import TOKEN, settings
from fastapi.testclient import TestClient
from pdf_fixtures import make_pdf
from samples import JOB_ID, doc, para, petition, request, run, section

from eda_doc_engine import service as service_module
from eda_doc_engine.jobs import JobRegistry
from eda_doc_engine.main import create_app
from eda_doc_engine.models.generated.export_schema import ExportResult


class FakeGotenberg:
    def __init__(self, pdf: bytes | None = None, status: int = 200) -> None:
        self.pdf = pdf if pdf is not None else make_pdf()
        self.status = status
        self.paths: list[str] = []

    def __call__(self, req: httpx2.Request) -> httpx2.Response:
        self.paths.append(req.url.path)
        if req.url.path == "/version":
            return httpx2.Response(200, text="8.37.0")
        return httpx2.Response(self.status, content=self.pdf)


@pytest.fixture
def fake() -> FakeGotenberg:
    return FakeGotenberg()


@pytest.fixture
def client(tmp_path: Path, fake: FakeGotenberg) -> Iterator[TestClient]:
    app = create_app(
        settings(max_upload_mb=1),
        token=TOKEN,
        gotenberg_transport=httpx2.MockTransport(fake),
        job_root=tmp_path,
    )
    with TestClient(app) as c:
        yield c


def job_dirs(root: Path) -> list[Path]:
    return [p for p in root.iterdir() if p.name.startswith("job-")]


# ---------- KK-P19a-17: Bearer ----------


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer yanlis"},
        {"Authorization": "Basic " + TOKEN.decode()},
        {"Authorization": "Bearer"},
    ],
)
def test_kk_p19a_17_bearer_required(client: TestClient, headers: dict[str, str]) -> None:
    for method, url in [
        ("POST", "/v1/export"),
        ("GET", f"/v1/jobs/{JOB_ID}/derived/export"),
        ("DELETE", f"/v1/jobs/{JOB_ID}"),
    ]:
        res = client.request(method, url, headers=headers, json=request(petition(1)))
        assert res.status_code == 401
        assert res.json()["code"] == "unauthorized"
        assert res.headers["www-authenticate"] == "Bearer"
    assert client.get("/health").status_code == 200


# ---------- dışa aktarım akışı ----------


@pytest.mark.parametrize("fmt", ["udf", "docx"])
def test_kk_p19a_17_export_download_delete(
    client: TestClient, auth: dict[str, str], tmp_path: Path, fmt: str
) -> None:
    res = client.post("/v1/export", headers=auth, json=request(petition(2), fmt))
    assert res.status_code == 200, res.text
    result = ExportResult.model_validate(res.json())
    assert result.format.value == fmt
    assert str(result.jobId) == JOB_ID
    assert result.report.pageCount is None
    assert result.report.gotenbergVersion is None
    assert result.report.docEngineVersion == "0.0.0"
    assert "Ayşe" not in res.text  # yanıt belge içeriği taşımaz
    got = client.get(f"/v1/jobs/{JOB_ID}/derived/export", headers=auth)
    assert got.status_code == 200
    assert got.headers["content-type"] == "application/octet-stream"
    assert hashlib.sha256(got.content).hexdigest() == result.sha256
    assert len(got.content) == result.sizeBytes
    assert len(job_dirs(tmp_path)) == 1
    assert client.delete(f"/v1/jobs/{JOB_ID}", headers=auth).status_code == 204
    assert job_dirs(tmp_path) == []
    missing = client.get(f"/v1/jobs/{JOB_ID}/derived/export", headers=auth)
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"


def test_kk_p19a_13_pdf_export_through_gotenberg(
    client: TestClient, auth: dict[str, str], fake: FakeGotenberg
) -> None:
    res = client.post("/v1/export", headers=auth, json=request(petition(2), "pdf"))
    assert res.status_code == 200, res.text
    result = ExportResult.model_validate(res.json())
    assert result.report.pageCount is not None
    assert result.report.pageCount.root == 2
    assert result.report.gotenbergVersion == "8.37.0"
    assert fake.paths == ["/forms/libreoffice/convert", "/version"]
    got = client.get(f"/v1/jobs/{JOB_ID}/derived/export", headers=auth)
    assert got.content.startswith(b"%PDF")
    assert hashlib.sha256(got.content).hexdigest() == result.sha256


@pytest.mark.parametrize("pdf_status", [(make_pdf(width=612, height=792), 200), (b"x", 500)])
def test_kk_p19a_13_pdf_failures_are_export_failed(
    tmp_path: Path, auth: dict[str, str], pdf_status: tuple[bytes, int]
) -> None:
    fake = FakeGotenberg(*pdf_status)
    app = create_app(
        settings(), token=TOKEN, gotenberg_transport=httpx2.MockTransport(fake), job_root=tmp_path
    )
    with TestClient(app) as c:
        res = c.post("/v1/export", headers=auth, json=request(petition(1), "pdf"))
    assert res.status_code == 500
    assert res.json()["code"] == "export_failed"
    assert job_dirs(tmp_path) == []


# ---------- KK-P19a-12: hata kodları ----------


def test_kk_p19a_12_invalid_docast_422_without_echo(
    client: TestClient, auth: dict[str, str], tmp_path: Path
) -> None:
    bad = request(petition(1))
    bad["docAst"]["schemaVersion"] = 9
    res = client.post("/v1/export", headers=auth, json=bad)
    assert res.status_code == 422
    assert res.json() == {"code": "invalid_docast", "message": res.json()["message"]}
    assert "Ayşe" not in res.text
    assert "ÖRNEK" not in res.text
    d2 = request(
        doc([section("generic", [para(run("x"), indent="hanging", hanging=30, tabs=[10])])])
    )
    res = client.post("/v1/export", headers=auth, json=d2)
    assert res.status_code == 422
    assert res.json()["code"] == "invalid_docast"
    assert job_dirs(tmp_path) == []


def test_kk_p19a_12_forbidden_phrase_422(client: TestClient, auth: dict[str, str]) -> None:
    d = request(doc([section("generic", [para(run("Bu belge e-İmzalıdır."))])]), "docx")
    res = client.post("/v1/export", headers=auth, json=d)
    assert res.status_code == 422
    assert res.json()["code"] == "forbidden_phrase"
    assert "İmzalıdır" not in res.text  # belge metni yankılanmaz


def test_kk_p19a_17_body_limit_413(client: TestClient, auth: dict[str, str]) -> None:
    big = request(doc([section("generic", [para(run("ğ" * (1024 * 1024)))])]))
    res = client.post("/v1/export", headers=auth, json=big)
    assert res.status_code == 413
    assert res.json()["code"] == "payload_too_large"
    chunked = client.post(
        "/v1/export",
        headers={**auth, "content-type": "application/json"},
        content=iter([json.dumps(big).encode()]),
    )
    assert chunked.status_code == 413


# ---------- KK-P19a-17: eşzamanlılık 1 ----------


def test_kk_p19a_17_concurrency_one(
    tmp_path: Path, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    active = 0
    peak = 0
    real = service_module.run_task

    async def tracking(*args: Any, **kwargs: Any) -> Any:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(0.05)
            return await real(*args, **kwargs)
        finally:
            active -= 1

    monkeypatch.setattr(service_module, "run_task", tracking)
    app = create_app(settings(), token=TOKEN, job_root=tmp_path)

    async def scenario() -> list[int]:
        transport = httpx2.ASGITransport(app=app)
        async with httpx2.AsyncClient(transport=transport, base_url="http://doc-engine") as c:
            reqs = []
            for i in range(3):
                body = request(petition(1), "udf")
                body["jobId"] = f"0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f7{i}"
                reqs.append(c.post("/v1/export", headers=auth, json=body))
            return [r.status_code for r in await asyncio.gather(*reqs)]

    assert asyncio.run(scenario()) == [200, 200, 200]
    assert peak == 1


# ---------- iş ömrü (033 §7.4: 10 dk) ----------


def test_kk_p19a_17_job_ttl_sweep(tmp_path: Path) -> None:
    import uuid

    now = [0.0]
    reg = JobRegistry(tmp_path, clock=lambda: now[0], ttl_sec=600)
    a = reg.create(uuid.UUID(JOB_ID))
    assert a.directory.stat().st_mode & 0o777 == 0o700
    now[0] = 601
    assert reg.get(uuid.UUID(JOB_ID)) is None
    assert not a.directory.exists()
    reg.create(uuid.UUID(JOB_ID))
    now[0] = 1300
    assert reg.sweep() == 1
    assert job_dirs(tmp_path) == []
