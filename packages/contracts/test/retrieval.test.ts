// @tk TK-17
// KK-P14a-16 (KK-013-6 ile birlikte): getirim (023 §4.8) ve korpus veri seti (034 §5.4) sözleşmeleri
// geçerli / geçersiz örneklerle. Örnek değerler sentetiktir.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CourtType as ApiCourtType } from '../src/api/decisions.ts';
import {
  CorpusDatasetRecord,
  CorpusRejectReason,
  IngestionPhase,
  recordSha256Matches,
  WithdrawnReason,
} from '../src/corpus-dataset.ts';
import { CORPUS_REJECT_REASONS, SEARCH_COURT_TYPES } from '../src/enums.ts';
import {
  CorpusFilters,
  CourtType,
  RetrievalHit,
  RetrievalRequest,
  RetrievalResult,
} from '../src/retrieval.ts';

const UUID = '01929b2e-0000-7000-8000-000000000001';
const filters = { courtTypes: null, chamberCodes: null, dateFrom: null, dateTo: null };

describe('KK-P14a-16: getirim sözleşmeleri (023 §4.8)', () => {
  it('CourtType tek tanım: api/decisions ile aynı nesne, SEARCH_COURT_TYPES (11 değer)', () => {
    expect(CourtType).toBe(ApiCourtType);
    expect(CourtType.options).toEqual([...SEARCH_COURT_TYPES]);
    expect(CourtType.safeParse('yerel_hukuk').success).toBe(false);
  });

  it('RetrievalRequest geçerli ve geçersiz örnekler', () => {
    expect(
      RetrievalRequest.safeParse({
        surface: 'eager',
        query: 'kıdem tazminatı',
        filters: {
          ...filters,
          courtTypes: ['yargitay'],
          chamberCodes: ['H9'],
          dateFrom: '2020-01-01',
        },
        userAskedLive: false,
      }).success,
    ).toBe(true);
    for (const bad of [
      { surface: 'chat', query: 'x', filters, userAskedLive: false },
      { surface: 'tool', query: '', filters, userAskedLive: false },
      {
        surface: 'tool',
        query: 'x',
        filters: { ...filters, chamberCodes: ['H99'] },
        userAskedLive: false,
      },
      {
        surface: 'tool',
        query: 'x',
        filters: { ...filters, dateFrom: '2025-01-02', dateTo: '2025-01-01' },
        userAskedLive: false,
      },
      { surface: 'tool', query: 'x', filters, userAskedLive: false, extra: 1 },
    ]) {
      expect(RetrievalRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(CorpusFilters.safeParse({ ...filters, courtTypes: [] }).success).toBe(false);
  });

  it('RetrievalHit ve RetrievalResult', () => {
    const hit = {
      decisionId: UUID,
      matchKind: 'hybrid',
      rank: 1,
      relevance: 'high',
      legs: { vec: 1, bm25: 3, fold: null, cite: null },
      vecSim: 0.71,
      chunks: [{ chunkId: UUID, sectionId: UUID, role: 'gerekce', charStart: 0, charEnd: 120 }],
    };
    expect(RetrievalHit.safeParse(hit).success).toBe(true);
    expect(RetrievalHit.safeParse({ ...hit, matchKind: 'fuzzy' }).success).toBe(false);
    expect(RetrievalHit.safeParse({ ...hit, rank: 0 }).success).toBe(false);
    expect(
      RetrievalHit.safeParse({ ...hit, chunks: [{ ...hit.chunks[0], charEnd: 0 }] }).success,
    ).toBe(false);
    const result = {
      hits: [hit],
      empty: false,
      liveReasons: ['few_local_results'],
      degraded: false,
      timingsMs: { bm25: 12 },
    };
    expect(RetrievalResult.safeParse(result).success).toBe(true);
    expect(RetrievalResult.safeParse({ ...result, liveReasons: ['because'] }).success).toBe(false);
  });
});

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const TEXT = 'ÖRNEK VERİ\n\nGEREKÇE\nÖrnek gerekçe metni.';
const record = {
  dataset_id: 'ornek-set-v1',
  license_id: 'CC0-1.0',
  source: 'bedesten',
  document_id: '9900000001',
  court_type: 'yargitay',
  court: 'Yargıtay',
  chamber: '9. Hukuk Dairesi',
  chamber_code: 'H9',
  esas_no: '2024/900101',
  karar_no: '2025/900102',
  decision_date: '2025-03-12',
  title: null,
  url: null,
  retrieved_at: '2026-10-01',
  text_markdown: TEXT,
  record_sha256: sha(TEXT),
};

describe('KK-P14a-16: korpus veri seti satırı (034 §5.4)', () => {
  it('geçerli satır; text_status varsayılanı ok; record_sha256 doğrulanır', () => {
    const r = CorpusDatasetRecord.parse(record);
    expect(r.text_status).toBe('ok');
    expect(recordSha256Matches(r, sha)).toBe(true);
    expect(recordSha256Matches({ ...r, text_markdown: `${TEXT} ` }, sha)).toBe(false);
  });

  it('lisans / veri seti kimliği zorunlu; biçimsiz özet, http adres ve boş metin reddedilir', () => {
    for (const bad of [
      { ...record, license_id: '' },
      { ...record, dataset_id: undefined },
      { ...record, record_sha256: 'abc' },
      { ...record, url: 'http://ornek.invalid/x' },
      { ...record, text_markdown: ' ' },
      { ...record, court_type: 'yerel_hukuk' },
    ]) {
      expect(CorpusDatasetRecord.safeParse(bad).success).toBe(false);
    }
    expect(
      CorpusDatasetRecord.safeParse({
        ...record,
        text_status: 'text_unavailable',
        text_markdown: '',
      }).success,
    ).toBe(true);
  });

  it('ret nedeni (15), alım evresi ve kaldırma nedeni kümeleri', () => {
    expect(CORPUS_REJECT_REASONS).toHaveLength(15);
    expect(CorpusRejectReason.safeParse('license_missing').success).toBe(true);
    expect(IngestionPhase.options).toEqual([
      'fetch',
      'awaiting_gpu_vectors',
      'load',
      'index',
      'done',
    ]);
    expect(WithdrawnReason.safeParse('kvkk_request').success).toBe(true);
    expect(WithdrawnReason.safeParse('other').success).toBe(false);
  });
});
