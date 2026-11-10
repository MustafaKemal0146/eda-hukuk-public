"""v1 uçları (084 §7). Rota adları `openapi.json` ile kesinleşir (AS-0301).

Yalnız worker çağırır; tüm `/v1` uçları Bearer ister. Yanıtta belge içeriği yoktur (yalnız kimlik,
biçim, boyut, özet, kod).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import FileResponse

from eda_doc_engine.errors import InvalidExtractRequest, NotFound, Unauthorized
from eda_doc_engine.extract_service import ExtractService
from eda_doc_engine.models.generated.export_schema import (
    DocEngineError,
    ExportRequest,
    ExportResult,
)
from eda_doc_engine.models.generated.extract_schema import ExtractResult
from eda_doc_engine.security import BearerVerifier
from eda_doc_engine.service import ExportService

_ERRORS: dict[int | str, dict[str, object]] = {
    401: {"model": DocEngineError},
    422: {"model": DocEngineError},
    500: {"model": DocEngineError},
    504: {"model": DocEngineError},
}


def _service(request: Request) -> ExportService:
    service: ExportService = request.app.state.export_service
    return service


def _extractor(request: Request) -> ExtractService:
    service: ExtractService = request.app.state.extract_service
    return service


# Bu dilimde çıkarılabilen türler (contracts `EXTRACT_FILE_TYPES`).
_EXTRACT_TYPES = frozenset({"pdf", "docx", "txt"})


def require_bearer(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    verifier: BearerVerifier = request.app.state.bearer
    if not verifier.verify(authorization):
        raise Unauthorized


router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)], responses=_ERRORS)


@router.post("/export", response_model=ExportResult)
async def export(
    body: ExportRequest, service: Annotated[ExportService, Depends(_service)]
) -> ExportResult:
    return await service.export(body)


@router.get(
    "/jobs/{jobId}/derived/export",
    response_class=FileResponse,
    responses={200: {"content": {"application/octet-stream": {}}}, 404: {"model": DocEngineError}},
)
async def derived_export(
    jobId: uuid.UUID,
    service: Annotated[ExportService, Depends(_service)],
) -> FileResponse:
    path = service.export_path(jobId)
    if path is None or not path.is_file():
        raise NotFound
    return FileResponse(path, media_type="application/octet-stream")


@router.delete("/jobs/{jobId}", status_code=204)
async def delete_job(
    jobId: uuid.UUID,
    service: Annotated[ExportService, Depends(_service)],
) -> Response:
    service.jobs.delete(jobId)
    return Response(status_code=204)


@router.post("/extract", response_model=ExtractResult)
async def extract(
    request: Request, service: Annotated[ExtractService, Depends(_extractor)]
) -> ExtractResult:
    """Gövde ham baytlardır (033 §7.4); başlıklar `X-Eda-Job-Id`, `X-Eda-File-Type`,
    `X-Eda-Max-Pages`. Yapısal ret `verdict: reject` ile 200 döner."""
    headers = request.headers
    try:
        job_id = uuid.UUID(headers.get("x-eda-job-id", ""))
        max_pages = int(headers.get("x-eda-max-pages", ""))
    except ValueError:
        raise InvalidExtractRequest from None
    file_type = headers.get("x-eda-file-type", "")
    if file_type not in _EXTRACT_TYPES or not 1 <= max_pages <= 100_000:
        raise InvalidExtractRequest
    body = await request.body()
    if not body:
        raise InvalidExtractRequest
    return await service.extract(job_id, file_type, max_pages, body)
