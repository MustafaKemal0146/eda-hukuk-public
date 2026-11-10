// Dava dosyası evrak uçları (033 §6, §10, §11; 041): `POST /api/v1/files`, `GET /api/v1/files/{id}`,
// `GET /api/v1/cases/{id}/files`, `DELETE /api/v1/files/{id}`, indirme belirteci ve içerik.
// Evrak adı (`name`) kullanıcı içeriğidir: log, span, metrik, hata gövdesi ve denetim metadata'sına
// YAZILMAZ (033 D6, D9). İstemciye anahtar sürümü, sarılı anahtar ve nesne anahtarı verilmez.
import { z } from 'zod';
import { ACCEPTED_FILE_TYPES, FILE_ORIGINS, FILE_STATUS_REASONS, FILE_STATUSES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

/** Sunucunun açık metin evrak adı üst sınırı (033 §2.1). */
export const FILE_NAME_MAX = 200;
/** İndirme yanıtındaki `filename` üst sınırı (033 §10.3). */
export const DOWNLOAD_NAME_MAX = 150;

/** İndirilebilir nesne varyantları (033 §4.3, §10.1); `export` yalnız dışa aktarım nesnesidir. */
export const FILE_DOWNLOAD_VARIANTS = ['orig', 'searchable', 'clean'] as const;
export type FileDownloadVariant = (typeof FILE_DOWNLOAD_VARIANTS)[number];

export const FileDto = z.strictObject({
  id: z.uuid(),
  caseId: z.uuid().nullable(),
  origin: z.enum(FILE_ORIGINS),
  /** Kullanıcının verdiği ad (NFC, kontrol karakteri ve yol ayırıcısız); log'a yazılmaz. */
  name: z.string().min(1).max(FILE_NAME_MAX),
  fileType: z.enum(ACCEPTED_FILE_TYPES),
  sizeBytes: z.number().int().positive(),
  /** Özgün baytların SHA-256 özeti, küçük harf onaltılık. E-imza değildir (033 §8.2). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(FILE_STATUSES),
  statusReason: z.enum(FILE_STATUS_REASONS).nullable(),
  /** Virüs taraması temiz bitti mi; `false` iken indirme ve işleme yoktur (D5). */
  scanned: z.boolean(),
  pageCount: z.number().int().positive().nullable(),
  hasSearchable: z.boolean(),
  hasClean: z.boolean(),
  progressDone: z.number().int().nonnegative().nullable(),
  progressTotal: z.number().int().positive().nullable(),
  /** Yükleyen oturumdaki kullanıcı mı. */
  mine: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type FileDtoValue = z.infer<typeof FileDto>;

/** `multipart/form-data` metin alanları; `file` parçası en sonda gelir (033 §6.1). */
export const FileUploadFields = z.strictObject({
  caseId: z.uuid().optional(),
  origin: z.enum(['chat_attachment', 'kunye_check', 'document_import']).optional(),
  originId: z.uuid().optional(),
  batch: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type FileUploadFieldsValue = z.infer<typeof FileUploadFields>;

export const FileUploadResponse = z.strictObject({ file: FileDto });
export type FileUploadResponseValue = z.infer<typeof FileUploadResponse>;

export const ListCaseFilesQuery = z.strictObject({
  status: z.enum(FILE_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListCaseFilesQueryValue = z.infer<typeof ListCaseFilesQuery>;

export const FileListResponse = z.strictObject({
  items: z.array(FileDto),
  nextCursor: z.string().nullable(),
});
export type FileListResponseValue = z.infer<typeof FileListResponse>;

/** Silme isteği sonucu: evrak anında listeden çıkar, fiilî imha `graceUntil` sonrasındadır (033 §11). */
export const FileDeleteResponse = z.strictObject({
  id: z.uuid(),
  deleteRequestedAt: IsoDateTime,
  graceUntil: IsoDateTime,
});
export type FileDeleteResponseValue = z.infer<typeof FileDeleteResponse>;

export const DownloadTokenInput = z.strictObject({
  variant: z.enum(FILE_DOWNLOAD_VARIANTS).default('orig'),
});
export type DownloadTokenInputValue = z.infer<typeof DownloadTokenInput>;

/** Tek kullanımlık belirteç (033 §10.4); URL göreli, ham belirteç yalnız burada döner. */
export const DownloadTokenResponse = z.strictObject({
  url: z
    .string()
    .regex(
      /^\/api\/v1\/files\/[0-9a-f-]{36}\/content\?dt=[A-Za-z0-9_-]{43}(&variant=(searchable|clean))?$/,
    ),
  expiresInSec: z.number().int().positive(),
});
export type DownloadTokenResponseValue = z.infer<typeof DownloadTokenResponse>;

export const FileContentQuery = z.strictObject({
  variant: z.enum(FILE_DOWNLOAD_VARIANTS).default('orig'),
  dt: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
});
export type FileContentQueryValue = z.infer<typeof FileContentQuery>;
