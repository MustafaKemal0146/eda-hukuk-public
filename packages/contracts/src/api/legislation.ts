// Mevzuat HTTP sözleşmeleri (041 §2.4, §5.3; 053-05 §1, §9; P15.9). Korpus (P15 anlık görüntü) gelene
// dek tüm yanıtlar canlı kaynaktandır (`origin: 'live'`); sapmalar 'dedir.
import { z } from 'zod';
import { CONFIG_DEFAULTS } from '../config/defaults.ts';
import { LAW_STATUSES, LAW_TYPES, type LawType, type McpLawType } from '../enums.ts';

const IsoDay = z.iso.date();

export const LawTypeDto = z.enum(LAW_TYPES);
export const LawStatusDto = z.enum(LAW_STATUSES);

/** Yol parametreleri (053-05 §1.1). */
export const LAW_NO_PATTERN = /^[0-9]{1,6}$/;
export const ARTICLE_NO_URL_PATTERN = /^(G|E|M)?[0-9]{1,4}(-[A-Za-z])?$/;
export const LawNoParam = z.string().regex(LAW_NO_PATTERN);
export const ArticleNoParam = z.string().regex(ARTICLE_NO_URL_PATTERN);

/** URL `tur` ↔ `law_type` (053-05 §1.2). */
export const LAW_TYPE_URL = {
  constitution: 'anayasa',
  law: 'kanun',
  decree_law: 'khk',
  presidential_decree: 'cbk',
  regulation: 'yonetmelik',
} as const satisfies Record<LawType, string>;
export type LawTypeUrl = (typeof LAW_TYPE_URL)[LawType];

export function lawTypeFromUrl(value: string | null | undefined): LawType | null {
  const hit = LAW_TYPES.find((t) => LAW_TYPE_URL[t] === value);
  return hit ?? null;
}

/**
 * MCP mevzuat türü (021 §5.6) ↔ `law_type` (030). Tüzük, tebliğ ve "diğer" kanonik `law_type`
 * kümesinde olmadığından listelenmez. MCP kümesinde anayasa türü yoktur; anayasa "kanun"
 * türüyle sorgulanır; `constitution` işareti @eda/legal kanun sözlüğünden (081 §6) gelir.
 */
export const MCP_TO_LAW_TYPE = {
  kanun: 'law',
  khk: 'decree_law',
  cbk: 'presidential_decree',
  yonetmelik: 'regulation',
  tuzuk: null,
  teblig: null,
  diger: null,
} as const satisfies Record<McpLawType, LawType | null>;

export const LAW_TYPE_TO_MCP = {
  constitution: 'kanun',
  law: 'kanun',
  decree_law: 'khk',
  presidential_decree: 'cbk',
  regulation: 'yonetmelik',
} as const satisfies Record<LawType, McpLawType>;

export const LegislationSearchRequest = z.strictObject({
  query: z.string().trim().min(2).max(500),
  lawNo: LawNoParam.nullable(),
  lawType: LawTypeDto.nullable(),
  includeRepealed: z.boolean(),
});
export type LegislationSearchRequestValue = z.infer<typeof LegislationSearchRequest>;

export const LegislationHitDto = z.strictObject({
  lawNo: z.string(),
  lawType: LawTypeDto,
  lawTitle: z.string(),
  shortName: z.string().nullable(),
  /** URL biçimi (352, 49-A, G5, E3); kanun adı eşleşmesinde madde yoktur → `null`. */
  articleNo: z.string().nullable(),
  articleTitle: z.string().nullable(),
  snippet: z.string().max(300).nullable(),
  highlights: z.array(z.strictObject({ start: z.number().int(), end: z.number().int() })),
  status: LawStatusDto,
  matchKind: z.enum(['article_citation', 'hybrid']),
  /** Yüzde yok; canlı sonuçta puan olmadığından `null`. */
  relevance: z.enum(['high', 'medium']).nullable(),
  origin: z.enum(['corpus', 'live']),
});
export type LegislationHitDtoValue = z.infer<typeof LegislationHitDto>;

export const LegislationSearchResultsDto = z.strictObject({
  items: z.array(LegislationHitDto).max(CONFIG_DEFAULTS['tools.legislationMaxResults']),
  empty: z.boolean(),
  degraded: z.boolean(),
});
export type LegislationSearchResultsDtoValue = z.infer<typeof LegislationSearchResultsDto>;

export const ArticleIndexItemDto = z.strictObject({
  articleNo: z.string(),
  title: z.string().nullable(),
  status: LawStatusDto,
  sortOrder: z.number().int(),
});

export const LEGISLATION_WARNINGS = ['future_effective'] as const;

export const LawDto = z.strictObject({
  lawNo: z.string(),
  lawType: LawTypeDto,
  title: z.string(),
  shortName: z.string().nullable(),
  officialGazetteDate: IsoDay.nullable(),
  officialGazetteNo: z.string().nullable(),
  acceptedDate: IsoDay.nullable(),
  lastAmendedDate: IsoDay.nullable(),
  status: LawStatusDto,
  sourceUrl: z.string().url().nullable(),
  /** Canlı köken: madde dizini hazır değil → 0 (P15 `law.ts` canlı yedek kuralı). */
  articleCount: z.number().int().min(0),
  lastSnapshotDate: IsoDay.nullable(),
  warnings: z.array(z.enum(LEGISLATION_WARNINGS)),
  origin: z.enum(['corpus', 'live']),
  retrievedAt: IsoDay.nullable(),
});
export type LawDtoValue = z.infer<typeof LawDto>;

export const ArticleDto = z.strictObject({
  lawNo: z.string(),
  lawType: LawTypeDto,
  lawTitle: z.string(),
  shortName: z.string().nullable(),
  /** URL biçimi. */
  articleNo: z.string(),
  title: z.string().nullable(),
  /** Düz metin; paragraflar `\n` ile ayrılır (HTML/markdown yorumlanmaz). */
  text: z.string(),
  status: LawStatusDto,
  amendedNote: z.string().nullable(),
  lastAmendedDate: IsoDay.nullable(),
  asOf: IsoDay.nullable(),
  asOfUnverified: z.boolean(),
  origin: z.enum(['corpus', 'live']),
  retrievedAt: IsoDay.nullable(),
  prevArticleNo: z.string().nullable(),
  nextArticleNo: z.string().nullable(),
  sourceUrl: z.string().url().nullable(),
  warnings: z.array(z.enum(LEGISLATION_WARNINGS)),
});
export type ArticleDtoValue = z.infer<typeof ArticleDto>;

/** `GET …/articles/:articleNo?type=&asOf=` sorgusu. */
export const ArticleQuery = z.strictObject({
  type: LawTypeDto.optional(),
  asOf: IsoDay.optional(),
});
export const LawQuery = z.strictObject({ type: LawTypeDto.optional() });

// --- Madde numarası biçimleri (053-05 §1.1; 023 §8) -------------------------------------------

/** ASCII harf büyütme; URL madde eki yalnız `[A-Za-z]` olduğundan yerel ayar kullanılmaz. */
function asciiUpper(c: string): string {
  return c.replace(/[a-z]/g, (x) => String.fromCharCode(x.charCodeAt(0) - 32));
}

/**
 * URL biçimi → canlı kaynak madde anahtarı (034 §9.3; yargi-mcp `article_no`): "49-A" → "49/A",
 * "G5" → "G5", "G5-A" → "G5/A", "E3" → "E3", "M18" → "M18"; baştaki sıfır atılır. Mükerrer maddede
 * harf yoktur → `null`.
 */
export function urlToSourceArticleNo(url: string): string | null {
  const m = ARTICLE_NO_URL_PATTERN.exec(url);
  if (!m) return null;
  const prefix = m[1] ?? '';
  const num = String(Number(url.replace(/^[GEM]/, '').replace(/-.*$/, '')));
  const letter = m[2] ? asciiUpper(m[2].slice(1)) : null;
  if (prefix === 'M' && letter !== null) return null;
  return `${prefix}${num}${letter ? `/${letter}` : ''}`;
}

/**
 * Canlı kaynak anahtarı → URL biçimi ("352/A" → "352-A", "G5" → "G5"); URL'de taşınamayan anahtarda
 * (Türkçe harfli "12/Ç" gibi) `null`. P11 öncesi yargi-mcp biçimi ("GEÇİCİ 5", "EK 3") da kabul edilir.
 */
export function sourceToUrlArticleNo(key: string): string | null {
  const m = /^(?:([GEM])|(GEÇİCİ|EK)\s+)?(\d{1,4})(?:\/([A-Za-z]))?$/u.exec(key.trim());
  if (!m) return null;
  const prefix = m[1] ?? (m[2] === 'GEÇİCİ' ? 'G' : m[2] === 'EK' ? 'E' : '');
  if (prefix === 'M' && m[4]) return null;
  return `${prefix}${Number(m[3])}${m[4] ? `-${asciiUpper(m[4])}` : ''}`;
}

/** Görüntü etiketi (053-05 §1.1): "m. 352", "m. 49/A", "geçici m. 5", "ek m. 3", "m. 18 (mükerrer)". */
export function articleLabel(url: string): string {
  const m = ARTICLE_NO_URL_PATTERN.exec(url);
  if (!m) return `m. ${url}`;
  const num = url.replace(/^[GEM]/, '').replace(/-.*$/, '');
  const letter = m[2] ? `/${asciiUpper(m[2].slice(1))}` : '';
  if (m[1] === 'G') return `geçici m. ${num}${letter}`;
  if (m[1] === 'E') return `ek m. ${num}${letter}`;
  if (m[1] === 'M') return `m. ${num}${letter} (mükerrer)`;
  return `m. ${num}${letter}`;
}

/** Madde atfı (053-05 §5.4): "TBK m. 352"; kısa ad yoksa "6098 s. K. m. 352". */
export function articleCitation(shortName: string | null, lawNo: string, url: string): string {
  return `${shortName ?? `${lawNo} s. K.`} ${articleLabel(url)}`;
}
