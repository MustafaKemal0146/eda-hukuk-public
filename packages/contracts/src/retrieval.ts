// Getirim sözleşmeleri (023 §4.8). `CourtType` tek tanımdır (`api/decisions.ts`, 002 §11
// `SEARCH_COURT_TYPES`; P14 K3): burada yeniden tanımlanmaz. Daire kodu deseni MCP `ChamberCode`'dur.
// `vecSim` iç kullanımdır: modele ve arayüze gitmez (023 §4.7).
import { z } from 'zod';
import { CourtType } from './api/decisions.ts';
import { DECISION_SECTION_ROLES, LIVE_REASONS, MATCH_KINDS, RETRIEVAL_SURFACES } from './enums.ts';
import { ChamberCode } from './mcp/common.ts';

export { CourtType };

/** 023 §4.8 sorgu metni üst sınırı; bacaklara giden kısım ayrıca `retrieval.queryMaxChars` ile kırpılır. */
export const RETRIEVAL_QUERY_MAX_CHARS = 20000;

export const MatchKind = z.enum(MATCH_KINDS);
export const RetrievalSurface = z.enum(RETRIEVAL_SURFACES);
export const LiveReason = z.enum(LIVE_REASONS);
export const RetrievalRelevance = z.enum(['high', 'medium']);

const IsoDay = z.iso.date();

/** Korpus süzgeçleri (023 §4.8; 023 §9 kapsam seçici eşlemesi). `null` = süzgeç yok. */
export const CorpusFilters = z
  .strictObject({
    courtTypes: z.array(CourtType).min(1).nullable(),
    chamberCodes: z.array(ChamberCode).min(1).nullable(),
    dateFrom: IsoDay.nullable(),
    dateTo: IsoDay.nullable(),
  })
  .refine((f) => f.dateFrom === null || f.dateTo === null || f.dateFrom <= f.dateTo, {
    message: 'Başlangıç tarihi bitiş tarihinden sonra olamaz.',
    path: ['dateTo'],
  });
export type CorpusFiltersValue = z.infer<typeof CorpusFilters>;

export const RetrievalRequest = z.strictObject({
  surface: RetrievalSurface,
  query: z.string().min(1).max(RETRIEVAL_QUERY_MAX_CHARS),
  filters: CorpusFilters,
  /** Kullanıcı "Canlı ara" dedi (021 ölçütü). */
  userAskedLive: z.boolean(),
});
export type RetrievalRequestValue = z.infer<typeof RetrievalRequest>;

const LegRank = z.number().int().min(1).nullable();

export const RetrievalLegs = z.strictObject({
  vec: LegRank,
  bm25: LegRank,
  fold: LegRank,
  cite: LegRank,
});

export const RetrievalChunkRef = z
  .strictObject({
    chunkId: z.uuid(),
    sectionId: z.uuid(),
    role: z.enum(DECISION_SECTION_ROLES),
    /** Bölüm metni içinde `[charStart, charEnd)` (034 §7.2). */
    charStart: z.number().int().min(0),
    charEnd: z.number().int().min(0),
  })
  .refine((c) => c.charEnd > c.charStart, {
    message: 'Parça aralığı boş olamaz.',
    path: ['charEnd'],
  });

export const RetrievalHit = z.strictObject({
  decisionId: z.uuid(),
  matchKind: MatchKind,
  rank: z.number().int().min(1),
  relevance: RetrievalRelevance,
  legs: RetrievalLegs,
  /** İç kullanım; modele / arayüze gitmez. */
  vecSim: z.number().min(-1).max(1).nullable(),
  chunks: z.array(RetrievalChunkRef),
});
export type RetrievalHitValue = z.infer<typeof RetrievalHit>;

export const RetrievalResult = z.strictObject({
  hits: z.array(RetrievalHit),
  /** `true` → SONUÇ YOK (023 §11; metin 024 `chat.no_results`, P14 K8). */
  empty: z.boolean(),
  /** Boş = canlı arama gerekmez. */
  liveReasons: z.array(LiveReason),
  /** Vektör bacağı atlandı. */
  degraded: z.boolean(),
  timingsMs: z.record(z.string(), z.number().min(0)),
});
export type RetrievalResultValue = z.infer<typeof RetrievalResult>;
