// Evrak satırından istemci DTO'su (yalnız güvenli alanlar; anahtar malzemesi ve nesne anahtarı yok).
import type { FileDtoValue } from '@eda/contracts/api/files';
import type { FileRow } from '../../repositories/files/files.ts';

export function fileDto(r: FileRow, userId: string): FileDtoValue {
  return {
    id: r.id,
    caseId: r.caseId,
    origin: r.origin as FileDtoValue['origin'],
    name: r.originalName,
    fileType: r.fileType as FileDtoValue['fileType'],
    sizeBytes: r.sizeBytes,
    sha256: r.sha256.toString('hex'),
    status: r.status as FileDtoValue['status'],
    statusReason: r.statusReason as FileDtoValue['statusReason'],
    scanned: r.scannedAt !== null,
    pageCount: r.pageCount,
    hasSearchable: r.hasSearchable,
    hasClean: r.hasClean,
    progressDone: r.progressDone,
    progressTotal: r.progressTotal,
    mine: r.uploadedBy === userId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
