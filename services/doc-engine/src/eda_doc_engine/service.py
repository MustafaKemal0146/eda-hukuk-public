"""Dışa aktarım iş akışı (084 §7 davranış 1-3, §6). HTTP bilmez.

Eşzamanlılık `DOC_ENGINE_CONCURRENCY` semaforudur (002 §5.7: 1). Belge işleme alt süreçtedir;
Gotenberg çağrısı ana süreçten yapılır. Log ve yanıtta belge içeriği yoktur.
"""

import asyncio
import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from eda_doc_engine import __version__
from eda_doc_engine.errors import (
    DocEngineFailure,
    ExportFailed,
    ExportTimeout,
    ForbiddenPhrase,
    InvalidDocAst,
)
from eda_doc_engine.jobs import Job, JobRegistry
from eda_doc_engine.models.generated.export_schema import (
    DegradedItem,
    ExportReport,
    ExportRequest,
    ExportResult,
    Format,
    PageCount,
)
from eda_doc_engine.pdf.gotenberg import GotenbergClient
from eda_doc_engine.sandbox import child
from eda_doc_engine.sandbox.runner import SandboxError, SandboxTimeout, run_task

_log = logging.getLogger("eda_doc_engine.export")
EXPORT_FILE: Final = "export.bin"
_FAILURES: Final[dict[str, type[DocEngineFailure]]] = {
    InvalidDocAst.code: InvalidDocAst,
    ForbiddenPhrase.code: ForbiddenPhrase,
    ExportFailed.code: ExportFailed,
}


@dataclass(frozen=True, slots=True)
class _Rendered:
    degraded: list[DegradedItem]
    title: str


class ExportService:
    def __init__(
        self,
        jobs: JobRegistry,
        gotenberg: GotenbergClient,
        concurrency: int,
        timeout_sec: float,
    ) -> None:
        self.jobs = jobs
        self._gotenberg = gotenberg
        self._sem = asyncio.Semaphore(concurrency)
        self._timeout = timeout_sec

    async def _task(self, task: str, payload: bytes, job: Job) -> dict[str, object]:
        try:
            result = await run_task(task, payload, job.directory, self._timeout)
        except SandboxTimeout:
            raise ExportTimeout from None
        except SandboxError:
            raise ExportFailed from None
        data = json.loads(result.stdout)
        if not isinstance(data, dict):
            raise ExportFailed
        if data.get("ok") is not True:
            raise _FAILURES.get(str(data.get("code")), ExportFailed)
        return data

    async def _render(self, request: ExportRequest, job: Job) -> _Rendered:
        out = await self._task("render", request.model_dump_json().encode("utf-8"), job)
        raw = out.get("degraded")
        degraded = [DegradedItem.model_validate(d) for d in (raw if isinstance(raw, list) else [])]
        return _Rendered(degraded, str(out.get("title", "")))

    async def export(self, request: ExportRequest) -> ExportResult:
        async with self._sem:
            job = self.jobs.create(request.jobId)
            try:
                return await self._export(request, job)
            except BaseException:
                self.jobs.delete(request.jobId)
                raise

    async def _export(self, request: ExportRequest, job: Job) -> ExportResult:
        rendered = await self._render(request, job)
        rendered_path = job.directory / child.RENDER_OUTPUT
        page_count: int | None = None
        gotenberg_version: str | None = None
        if request.format == Format.pdf:
            pdf = await self._gotenberg.convert_docx(rendered_path.read_bytes())
            (job.directory / child.GOTENBERG_PDF).write_bytes(pdf)
            title = json.dumps({"title": rendered.title}).encode("utf-8")
            checked = await self._task("pdfcheck", title, job)
            page_count = int(str(checked["pageCount"]))
            gotenberg_version = await self._gotenberg.version()
            final = job.directory / child.EXPORT_PDF
        else:
            final = rendered_path
        export_path = job.directory / EXPORT_FILE
        final.replace(export_path)
        data = export_path.read_bytes()
        job.export_path = export_path
        _log.info(
            "export tamamlandı",
            extra={"jobId": str(request.jobId), "format": request.format.value, "size": len(data)},
        )
        return ExportResult(
            jobId=request.jobId,
            format=request.format,
            sizeBytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
            report=ExportReport(
                degraded=rendered.degraded,
                pageCount=PageCount(page_count) if page_count is not None else None,
                docEngineVersion=__version__,
                gotenbergVersion=gotenberg_version,
            ),
        )

    @property
    def semaphore(self) -> asyncio.Semaphore:
        """Eşzamanlılık semaforu; metin çıkarma aynı sınırı paylaşır (`DOC_ENGINE_CONCURRENCY`)."""
        return self._sem

    def export_path(self, job_id: uuid.UUID) -> Path | None:
        job = self.jobs.get(job_id)
        return job.export_path if job is not None else None
