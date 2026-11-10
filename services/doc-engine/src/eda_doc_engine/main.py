"""FastAPI girişi (P19a.3, P19a.12).

`create_app()` fabrikadır (`uvicorn --factory eda_doc_engine.main:create_app` veya
`python -m eda_doc_engine`). Açılışta env (002 §5.7) ve Bearer token okunur; eksikte başlamaz.
Docling model varlık kontrolü yalnız `/v1/extract` (P20) eklendiğinde zorunludur (AS-0298).
OpenAPI çalışma zamanında yayımlanmaz; `openapi.json` depoda üretilmiş anlık görüntüdür.
"""

import asyncio
import contextlib
import shutil
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path

import httpx2
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from eda_doc_engine import __version__
from eda_doc_engine.api.v1 import router as v1_router
from eda_doc_engine.config import Settings, load_settings
from eda_doc_engine.errors import DocEngineFailure, ExportFailed, InvalidDocAst, PayloadTooLarge
from eda_doc_engine.extract_service import ExtractService
from eda_doc_engine.jobs import JobRegistry
from eda_doc_engine.limits import JOB_SWEEP_INTERVAL_SEC
from eda_doc_engine.models.generated.health_schema import HealthResponse, Status
from eda_doc_engine.pdf.gotenberg import GotenbergClient
from eda_doc_engine.security import BearerVerifier, load_token
from eda_doc_engine.service import ExportService


def _error(failure: type[DocEngineFailure] | DocEngineFailure) -> JSONResponse:
    return JSONResponse(
        {"code": failure.code, "message": failure.message},
        status_code=failure.status,
        headers={"WWW-Authenticate": "Bearer"} if failure.status == 401 else None,
    )


class BodyLimitMiddleware:
    """İstek gövdesi sınırı (`MAX_UPLOAD_MB`): `Content-Length` denetimi, ardından gövde sınıra
    kadar arabelleğe alınır ve uygulamaya yeniden oynatılır (parçalı aktarım dahil)."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope.get("headers", []):
            if name == b"content-length" and (not value.isdigit() or int(value) > self.max_bytes):
                await _error(PayloadTooLarge)(scope, receive, send)
                return
        chunks: list[bytes] = []
        seen = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return  # istemci bağlantıyı kesti
            body = message.get("body", b"")
            seen += len(body)
            if seen > self.max_bytes:
                await _error(PayloadTooLarge)(scope, receive, send)
                return
            chunks.append(body)
            if not message.get("more_body", False):
                break
        replay: list[Message] = [
            {"type": "http.request", "body": b"".join(chunks), "more_body": False}
        ]

        async def replay_receive() -> Message:
            if replay:
                return replay.pop()
            return await receive()

        await self.app(scope, replay_receive, send)


def check_prerequisites(cfg: Settings) -> None:
    """Fail-fast açılış denetimi: /opt/models varlığı ve tesseract dilleri (070 §10.4, 010 §3.5)."""
    if not cfg.docling_artifacts_path.is_dir():
        raise RuntimeError(f"Docling model dizini bulunamadı: {cfg.docling_artifacts_path}")
    tess = shutil.which("tesseract")
    if not tess:
        raise RuntimeError("tesseract bulunamadı")
    proc = subprocess.run(  # noqa: S603 - sabit argümanlar
        [tess, "--list-langs"], capture_output=True, text=True, check=False
    )
    if proc.returncode != 0:
        raise RuntimeError(f"tesseract --list-langs başarısız (çıkış {proc.returncode})")
    available = {line.strip() for line in proc.stdout.splitlines() if line.strip()}
    for lang in cfg.ocr_langs.split("+"):
        if lang and lang not in available:
            raise RuntimeError(f"tesseract dili eksik: {lang}")


def create_app(
    settings: Settings | None = None,
    *,
    token: bytes | None = None,
    gotenberg_transport: httpx2.AsyncBaseTransport | None = None,
    job_root: Path | None = None,
    check_prereqs: bool = True,
) -> FastAPI:
    cfg = settings if settings is not None else load_settings()
    if check_prereqs:
        check_prerequisites(cfg)
    secret = token if token is not None else load_token(cfg.token_file)
    jobs = JobRegistry(job_root)
    service = ExportService(
        jobs,
        GotenbergClient(cfg.gotenberg_url, transport=gotenberg_transport),
        concurrency=cfg.concurrency,
        timeout_sec=cfg.subprocess_timeout_sec,
    )

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        async def sweep() -> None:
            while True:
                await asyncio.sleep(JOB_SWEEP_INTERVAL_SEC)
                jobs.sweep()

        task = asyncio.create_task(sweep())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            jobs.clear()

    app = FastAPI(
        title="eda-doc-engine",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.settings = cfg
    app.state.bearer = BearerVerifier(secret)
    app.state.export_service = service
    app.state.extract_service = ExtractService(jobs, service.semaphore, cfg.subprocess_timeout_sec)

    @app.exception_handler(DocEngineFailure)
    async def _failure(_request: Request, exc: DocEngineFailure) -> JSONResponse:
        return _error(exc)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        # Doğrulama ayrıntısı (girdi değerleri belge içeriği taşır) yanıta yazılmaz.
        return _error(InvalidDocAst)

    @app.exception_handler(Exception)
    async def _unexpected(_request: Request, _exc: Exception) -> JSONResponse:
        return _error(ExportFailed)

    @app.get("/health")
    def health() -> HealthResponse:
        return HealthResponse(status=Status.ok, version=__version__)

    app.include_router(v1_router)
    app.add_middleware(BodyLimitMiddleware, max_bytes=cfg.max_body_bytes)
    return app
