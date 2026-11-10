"""Metin çıkarma iş akışı (033 §7.4; P21 ilk dilimi, AS-0412). HTTP bilmez.

Girdi baytları sunucu üretimli iş dizinine sabit adla yazılır, ayrıştırma alt süreçte yapılır
(`sandbox/child.py` `extract`), iş dizini her durumda silinir (türev yok). Eşzamanlılık dışa
aktarımla ORTAK semafordur (`DOC_ENGINE_CONCURRENCY`). Log ve hata yanıtında belge içeriği yoktur.
"""

import asyncio
import json
import logging
import uuid

from eda_doc_engine.errors import ExportTimeout, ExtractFailed
from eda_doc_engine.jobs import JobRegistry
from eda_doc_engine.models.generated.extract_schema import ExtractResult
from eda_doc_engine.sandbox import child
from eda_doc_engine.sandbox.runner import SandboxError, SandboxTimeout, run_task

_log = logging.getLogger("eda_doc_engine.extract")


class ExtractService:
    def __init__(self, jobs: JobRegistry, semaphore: asyncio.Semaphore, timeout_sec: float) -> None:
        self._jobs = jobs
        self._sem = semaphore
        self._timeout = timeout_sec

    async def extract(
        self, job_id: uuid.UUID, file_type: str, max_pages: int, data: bytes
    ) -> ExtractResult:
        async with self._sem:
            job = self._jobs.create(job_id)
            try:
                (job.directory / child.EXTRACT_INPUT).write_bytes(data)
                payload = json.dumps({"fileType": file_type, "maxPages": max_pages}).encode()
                try:
                    out = await run_task("extract", payload, job.directory, self._timeout)
                except SandboxTimeout:
                    raise ExportTimeout from None
                except SandboxError:
                    raise ExtractFailed from None
                data_out = json.loads(out.stdout)
                if not isinstance(data_out, dict) or data_out.get("ok") is not True:
                    raise ExtractFailed
                raw = data_out.get("result")
                if not isinstance(raw, dict):
                    raise ExtractFailed
                result = ExtractResult.model_validate({**raw, "jobId": str(job_id)})
            finally:
                self._jobs.delete(job_id)
        _log.info(
            "extract tamamlandı",
            extra={
                "jobId": str(job_id),
                "fileType": file_type,
                "verdict": result.verdict.value,
                "pages": result.pageCount.root if result.pageCount is not None else None,
                "chars": len(result.text),
            },
        )
        return result
