// Korpus veri seti NDJSON satırı (034 §5.4) ve korpus alımı kümeleri (034 "Yeni tanımlanan adlar").
// Dosya biçimi dış kaynaklıdır: alan adları 034 örneğindeki gibi snake_case. `record_sha256` =
// `text_markdown` (normalize Markdown) UTF-8 baytlarının SHA-256'sı; özet işlevi çağırandan gelir
// (contracts yalnız zod'a bağlıdır). Bölümleme worker'da `@eda/legal/sections` ile yapılır.
import { z } from 'zod';
import {
  CORPUS_REJECT_REASONS,
  DECISION_WITHDRAWN_REASONS,
  INGESTION_PHASES,
  SEARCH_COURT_TYPES,
  SOURCE_CODES,
} from './enums.ts';
import { ChamberCode } from './mcp/common.ts';

export const CorpusRejectReason = z.enum(CORPUS_REJECT_REASONS);
export const IngestionPhase = z.enum(INGESTION_PHASES);
export const WithdrawnReason = z.enum(DECISION_WITHDRAWN_REASONS);

/** MCP `text_status` (021): `ok` → `full`, `text_unavailable` → `unavailable` (034 §3.2). */
export const DATASET_TEXT_STATUSES = ['ok', 'text_unavailable'] as const;

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const CorpusDatasetRecord = z
  .strictObject({
    dataset_id: z.string().min(1).max(200),
    license_id: z.string().min(1).max(200),
    source: z.enum(SOURCE_CODES),
    document_id: z.string().min(1).max(200),
    court_type: z.enum(SEARCH_COURT_TYPES),
    court: z.string().min(1).nullable(),
    chamber: z.string().min(1).nullable(),
    chamber_code: ChamberCode.nullable(),
    esas_no: z.string().min(1).nullable(),
    karar_no: z.string().min(1).nullable(),
    decision_date: z.iso.date().nullable(),
    title: z.string().nullable(),
    url: z.url({ protocol: /^https$/ }).nullable(),
    retrieved_at: z.iso.date(),
    /** 034 §5.4 örneğinde yok; metinsiz kabuk kayıt için. Varsayılan `ok`. */
    text_status: z.enum(DATASET_TEXT_STATUSES).default('ok'),
    text_markdown: z.string(),
    record_sha256: Sha256Hex,
  })
  .refine((r) => r.text_status === 'text_unavailable' || r.text_markdown.trim().length > 0, {
    message: 'Metni olan kayıtta text_markdown boş olamaz.',
    path: ['text_markdown'],
  });
export type CorpusDatasetRecordValue = z.infer<typeof CorpusDatasetRecord>;

/** `record_sha256` doğrulayıcı (034 §5.4): uyuşmazlık `parse_error`. Özet işlevi enjekte edilir. */
export function recordSha256Matches(
  record: Pick<CorpusDatasetRecordValue, 'text_markdown' | 'record_sha256'>,
  sha256Hex: (text: string) => string,
): boolean {
  return sha256Hex(record.text_markdown) === record.record_sha256;
}
