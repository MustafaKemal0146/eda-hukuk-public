"""İş kayıt defteri: `jobId` -> sunucu üretimli iş dizini ve türev dosyası (033 §7.4).

Türev baytlar yalnız tmpfs'teki iş dizinindedir; `DELETE /v1/jobs/{jobId}` veya `JOB_TTL_SEC` sonra
silinir. Kayıt bellekte tutulur (eşzamanlılık 1, tek süreç); yeniden başlatmada tmpfs zaten boşalır.
"""

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from eda_doc_engine.limits import JOB_TTL_SEC
from eda_doc_engine.sandbox.runner import create_job_dir, remove_job_dir


@dataclass(slots=True)
class Job:
    job_id: uuid.UUID
    directory: Path
    created: float
    export_path: Path | None = None


class JobRegistry:
    def __init__(
        self,
        root: Path | None = None,
        clock: Callable[[], float] = time.monotonic,
        ttl_sec: float = JOB_TTL_SEC,
    ) -> None:
        self._root = root
        self._clock = clock
        self._ttl = ttl_sec
        self._jobs: dict[uuid.UUID, Job] = {}

    def create(self, job_id: uuid.UUID) -> Job:
        self.delete(job_id)  # aynı iş yeniden istenirse eski türev silinir (idempotent)
        job = Job(job_id, create_job_dir(self._root), self._clock())
        self._jobs[job_id] = job
        return job

    def get(self, job_id: uuid.UUID) -> Job | None:
        job = self._jobs.get(job_id)
        if job is not None and self._clock() - job.created > self._ttl:
            self.delete(job_id)
            return None
        return job

    def delete(self, job_id: uuid.UUID) -> bool:
        job = self._jobs.pop(job_id, None)
        if job is None:
            return False
        remove_job_dir(job.directory)
        return True

    def sweep(self) -> int:
        now = self._clock()
        expired = [jid for jid, job in self._jobs.items() if now - job.created > self._ttl]
        for jid in expired:
            self.delete(jid)
        return len(expired)

    def clear(self) -> None:
        for jid in list(self._jobs):
            self.delete(jid)
