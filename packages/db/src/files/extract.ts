// `file.extract` işinin DB adımları (033 §7.1-§7.2, §7.9; P21 ilk dilimi). worker `eda_worker`
// rolüyle, yükleyen kullanıcının kiracı bağlamında (`withTenant`; RLS açık) çalışır. Yalnız temiz
// taranmış (`scanned_at` dolu), silinmek üzere olmayan, `extracting` durumundaki evrak işlenir; her
// güncelleme bu koşulla korunur (idempotent). Metin yalnız `file_texts.text` kolonuna yazılır.
import type { TenantTx } from '../tenant.ts';

export interface ExtractTarget {
  readonly id: string;
  readonly caseId: string | null;
  readonly status: string;
  readonly fileType: string;
  readonly scannedAt: Date | null;
  readonly deleteRequestedAt: Date | null;
  readonly objectKey: string;
  readonly keyVersion: number;
  readonly wrapDekVersion: number;
  readonly wrappedFileKey: Buffer;
}

export async function loadExtractTarget(
  tx: TenantTx,
  orgId: string,
  fileId: string,
): Promise<ExtractTarget | null> {
  const r = await tx.query(
    `SELECT id, case_id, status, file_type, scanned_at, delete_requested_at, object_key, key_version,
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
    fileType: String(x.file_type),
    scannedAt: date(x.scanned_at),
    deleteRequestedAt: date(x.delete_requested_at),
    objectKey: String(x.object_key),
    keyVersion: Number(x.key_version),
    wrapDekVersion: Number(x.wrap_dek_version),
    wrappedFileKey: x.wrapped_file_key as Buffer,
  };
}

/** İşlenebilir: temiz taranmış, silinmek üzere değil, `extracting`. */
const OPEN = `scanned_at IS NOT NULL AND delete_requested_at IS NULL AND status = 'extracting'`;

export interface ExtractedText {
  readonly text: string;
  readonly tokenCount: number;
  readonly pageCount: number | null;
  readonly pageOffsets: readonly number[];
  readonly hiddenContentReport: unknown;
  readonly hasHiddenContent: boolean;
  readonly extractorVersion: string;
  /** Sonraki durum: inbox kısayolu `ready` (033 §7.9), dava evrakı `chunking`. */
  readonly nextStatus: 'ready' | 'chunking';
}

/**
 * Metin + durum aynı işlemde: `file_texts` (yeniden işlemede üzerine yazılır) ve `files` durumu.
 * Evrak bu arada silinmek üzere işaretlendiyse veya durumu değiştiyse hiçbir şey yazılmaz (`false`).
 */
export async function finishExtract(
  tx: TenantTx,
  orgId: string,
  fileId: string,
  t: ExtractedText,
): Promise<boolean> {
  const upd = await tx.query(
    `UPDATE app.files
        SET status = $3, status_reason = NULL, page_count = $4, has_text_layer = true,
            progress_done = NULL, progress_total = NULL,
            ready_at = CASE WHEN $3 = 'ready' THEN now() ELSE ready_at END
      WHERE org_id = $1 AND id = $2 AND ${OPEN}`,
    [orgId, fileId, t.nextStatus, t.pageCount],
  );
  if ((upd.rowCount ?? 0) === 0) return false;
  await tx.query(
    `INSERT INTO app.file_texts
       (file_id, org_id, text, token_count, page_count, page_offsets, extracted_at, extraction_method,
        hidden_content_report, has_hidden_content, extractor_version)
     VALUES ($2, $1, $3, $4, $5, $6, now(), 'text_layer', $7::jsonb, $8, $9)
     ON CONFLICT (file_id) DO UPDATE
        SET text = EXCLUDED.text, token_count = EXCLUDED.token_count,
            page_count = EXCLUDED.page_count, page_offsets = EXCLUDED.page_offsets,
            extracted_at = EXCLUDED.extracted_at, extraction_method = EXCLUDED.extraction_method,
            hidden_content_report = EXCLUDED.hidden_content_report,
            has_hidden_content = EXCLUDED.has_hidden_content,
            extractor_version = EXCLUDED.extractor_version`,
    [
      orgId,
      fileId,
      t.text,
      t.tokenCount,
      t.pageCount,
      t.pageOffsets,
      JSON.stringify(t.hiddenContentReport),
      t.hasHiddenContent,
      t.extractorVersion,
    ],
  );
  return true;
}

/**
 * Metin katmanı yok (taranmış PDF) veya sayfa sınırı: `ocr_skipped` (033 §7.1). OCR bu dilimde yoktur;
 * evrak saklıdır ve indirilebilir, sohbet bağlamına girmez.
 */
export async function markOcrSkipped(
  tx: TenantTx,
  orgId: string,
  fileId: string,
  o: { pageCount: number | null; reason: 'page_limit' | null },
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE app.files SET status = 'ocr_skipped', status_reason = $3, page_count = $4,
            has_text_layer = false
      WHERE org_id = $1 AND id = $2 AND ${OPEN}`,
    [orgId, fileId, o.reason, o.pageCount],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Dosyaya ait kalıcı ret (`rejectReason`) veya bütünlük hatası: `failed` + neden. */
export async function failExtract(
  tx: TenantTx,
  orgId: string,
  fileId: string,
  reason: string,
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE app.files SET status = 'failed', status_reason = $3
      WHERE org_id = $1 AND id = $2 AND ${OPEN}`,
    [orgId, fileId, reason],
  );
  return (r.rowCount ?? 0) > 0;
}

/** doc-engine kesintisi: durum DEĞİŞMEZ, yalnız bilgi amaçlı `doc_engine_error` (033 §7.1). */
export async function noteDocEngineUnavailable(
  tx: TenantTx,
  orgId: string,
  fileId: string,
): Promise<void> {
  await tx.query(
    `UPDATE app.files SET status_reason = 'doc_engine_error' WHERE org_id = $1 AND id = $2 AND ${OPEN}`,
    [orgId, fileId],
  );
}
