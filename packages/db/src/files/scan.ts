// `file.scan` işinin DB adımları (033 §7.1-§7.2, §7.6; D5): worker `eda_worker` rolüyle ve yükleyen
// kullanıcının kiracı bağlamında (`withTenant`; RLS aynen geçerli) çalışır. Her güncelleme
// idempotent ve korumalıdır: silinmek üzere işaretli, karantinadaki veya zaten taranmış evrak
// DEĞİŞTİRİLMEZ. `scanned_at` yalnız temiz taramada yazılır; NULL iken indirme ve işleme yoktur.
// Virüs imza adı hiçbir kolona yazılmaz (yalnız `status_reason = av_detected`).
import type { TenantTx } from '../tenant.ts';

export interface ScanTarget {
  readonly id: string;
  readonly caseId: string | null;
  readonly status: string;
  readonly scannedAt: Date | null;
  readonly deleteRequestedAt: Date | null;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly keyVersion: number;
  readonly wrapDekVersion: number;
  readonly wrappedFileKey: Buffer;
}

/** Evrak satırı (RLS görünürlüğü altında); yoksa `null`. */
export async function loadScanTarget(
  tx: TenantTx,
  orgId: string,
  fileId: string,
): Promise<ScanTarget | null> {
  const r = await tx.query(
    `SELECT id, case_id, status, scanned_at, delete_requested_at, object_key, size_bytes, key_version,
            wrap_dek_version, wrapped_file_key
       FROM app.files WHERE org_id = $1 AND id = $2`,
    [orgId, fileId],
  );
  const x = r.rows[0] as Record<string, unknown> | undefined;
  if (x === undefined) return null;
  const date = (v: unknown): Date | null =>
    v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));
  return {
    id: String(x.id),
    caseId: x.case_id === null ? null : String(x.case_id),
    status: String(x.status),
    scannedAt: date(x.scanned_at),
    deleteRequestedAt: date(x.delete_requested_at),
    objectKey: String(x.object_key),
    sizeBytes: Number(x.size_bytes),
    keyVersion: Number(x.key_version),
    wrapDekVersion: Number(x.wrap_dek_version),
    wrappedFileKey: x.wrapped_file_key as Buffer,
  };
}

/** İşlenebilir durum: taranmamış, silinmek üzere değil, karantinada değil. */
const OPEN = `scanned_at IS NULL AND delete_requested_at IS NULL AND status IN ('uploaded', 'scanning')`;

/** `uploaded -> scanning`; başka durumdaysa dokunmaz. Güncellenen satır sayısı. */
export async function markScanning(tx: TenantTx, orgId: string, fileId: string): Promise<boolean> {
  const r = await tx.query(
    `UPDATE app.files SET status = 'scanning'
      WHERE org_id = $1 AND id = $2 AND ${OPEN}`,
    [orgId, fileId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Temiz tarama: `scanned_at = now()`, `scanning -> extracting` (033 §7.2). */
export async function finishScanClean(
  tx: TenantTx,
  orgId: string,
  fileId: string,
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE app.files SET status = 'extracting', status_reason = NULL, scanned_at = now()
      WHERE org_id = $1 AND id = $2 AND ${OPEN}`,
    [orgId, fileId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Zararlı yazılım bulundu: `quarantined` + `av_detected`; `scanned_at` NULL kalır (fail-closed). */
export async function finishScanInfected(
  tx: TenantTx,
  orgId: string,
  fileId: string,
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE app.files SET status = 'quarantined', status_reason = 'av_detected'
      WHERE org_id = $1 AND id = $2 AND ${OPEN}`,
    [orgId, fileId],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Altyapı kesintisi (ClamAV kapalı, imza eski): durum DEĞİŞMEZ; `status_reason` yalnız bilgi amaçlı
 * `av_unavailable` yazılır (033 §7.1). `scanned_at` NULL kaldığı için evrak taranmamış sayılır.
 */
export async function noteScanUnavailable(
  tx: TenantTx,
  orgId: string,
  fileId: string,
): Promise<void> {
  await tx.query(
    `UPDATE app.files SET status_reason = 'av_unavailable'
      WHERE org_id = $1 AND id = $2 AND ${OPEN}`,
    [orgId, fileId],
  );
}

/** Dosyaya ait kalıcı hata: `failed` + neden (`object_missing`, `integrity_failed`). */
export async function failScan(
  tx: TenantTx,
  orgId: string,
  fileId: string,
  reason: 'object_missing' | 'integrity_failed',
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE app.files SET status = 'failed', status_reason = $3
      WHERE org_id = $1 AND id = $2 AND ${OPEN}`,
    [orgId, fileId, reason],
  );
  return (r.rowCount ?? 0) > 0;
}
